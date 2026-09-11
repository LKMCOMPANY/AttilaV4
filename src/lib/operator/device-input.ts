import { z } from "zod";
import type { RequestSession } from "@/lib/auth/session";
import { actOnNode, fetchScreenshotJpeg, scrollBezier, shell, type V2Selector } from "@/lib/box-api";
import { androidDeepLink, getCurrentIme, restoreIme } from "@/lib/automation/adb-helpers";
import { typeIntoField } from "@/lib/engine/actor";
import type { DeviceRef } from "@/lib/engine/device";
import { readTree, readTreeAfterGesture, sleep, TreeUnreadableError } from "@/lib/engine/reader";
import { editTexts, type CompactTree, type TreeNode } from "@/lib/engine/ui/compact-tree";
import { SAFE_REACTION, type ScreenState } from "@/lib/engine/ui/screen-state";
import { selectorForMatcher } from "@/lib/engine/ui/selectors";
import { audit } from "@/lib/maintenance/audit";
import { WATCHED_PACKAGES } from "@/lib/maintenance/app-versions.mjs";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  classifyForOperator,
  DEFAULT_MAX_NODES,
  describeScreen,
  resolveRunningDevice,
  touchDevicePresence,
  type DeviceScreen,
} from "./device-screen";

/**
 * The operator's hands through the API — one gesture per call, on a running
 * device the caller may reach, with the guard-rails carried by the tool
 * rather than by whoever drives it (MAINTENANCE-AGENT.md, principle 10):
 *
 *   - text enters through ADBKeyboard only, never `input text`;
 *   - a security screen (`bouncer`) refuses every gesture unless the caller
 *     states an `override_reason`, which is journaled;
 *   - every gesture bumps `devices.last_seen` (the arbiter reads it as an
 *     operator on the device) and lands in `audit_log`;
 *   - the answer is the screen after the gesture, read fresh, so the caller
 *     never acts twice on a stale tree.
 */

const KEY_CODES = {
  back: 4,
  home: 3,
  recents: 187,
  enter: 66,
  delete: 67,
  volume_up: 24,
  volume_down: 25,
} as const;

export type PressKey = keyof typeof KEY_CODES;

/** The gestures a human may ask for, validated at the boundary. */
export const deviceInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("tap"),
    x: z.number().int().min(0).optional(),
    y: z.number().int().min(0).optional(),
    resource_id: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    content_desc: z.string().min(1).optional(),
  }),
  z.object({ action: z.literal("press"), key: z.enum(Object.keys(KEY_CODES) as [PressKey, ...PressKey[]]) }),
  z.object({
    action: z.literal("type"),
    text: z.string().min(1).max(2000),
    /** Click this field before typing (resource id); the focused field otherwise. */
    field_resource_id: z.string().min(1).optional(),
  }),
  z.object({
    action: z.literal("open_url"),
    url: z.string().url(),
    app: z.enum(["tiktok", "twitter"]).optional(),
  }),
  z.object({
    action: z.literal("swipe"),
    direction: z.enum(["up", "down", "left", "right"]),
  }),
]);

export type DeviceInput = z.infer<typeof deviceInputSchema>;

export interface DeviceInputOptions {
  /** Why the caller insists on acting on a security screen — journaled. */
  overrideReason?: string;
  includeScreenshot?: boolean;
  maxNodes?: number;
  /** `X-Attila-Client` of the caller (`macos`, `mcp`) for the audit trail. */
  client?: string | null;
}

export interface DeviceInputResult {
  error: string | null;
  performed?: string;
  /** The screen after the gesture (fresh read). */
  screen?: DeviceScreen;
  /** True when the read after the gesture could not be refreshed (1.1.3 line). */
  stale?: boolean;
}

/** States on which a hand must not act without saying why. */
const HANDS_OFF_STATES: readonly ScreenState[] = ["bouncer"];

export function isHandsOff(state: ScreenState): boolean {
  return HANDS_OFF_STATES.includes(state) && SAFE_REACTION[state] === "stop";
}

/** The selector a tap names, in the engine's own dialect (`selectors.ts`). */
export function selectorFor(input: Extract<DeviceInput, { action: "tap" }>): V2Selector | null {
  if (input.resource_id) return selectorForMatcher({ by: "resource_id", value: input.resource_id });
  if (input.text) return selectorForMatcher({ by: "text", value: input.text });
  if (input.content_desc) return selectorForMatcher({ by: "desc_contains", value: input.content_desc });
  return null;
}

/** One human-looking swipe in a direction, sized from the screen. */
export function swipeGesture(direction: "up" | "down" | "left" | "right", width: number, height: number) {
  const w = width || 1080;
  const h = height || 2340;
  const midX = Math.round(w * 0.5);
  const midY = Math.round(h * 0.5);
  const travelY = Math.round(h * 0.45);
  const travelX = Math.round(w * 0.6);
  const durationMs = 420;
  switch (direction) {
    case "up":
      return { startX: midX, startY: Math.round(h * 0.7), endX: midX - 8, endY: Math.round(h * 0.7) - travelY, durationMs };
    case "down":
      return { startX: midX, startY: Math.round(h * 0.3), endX: midX + 8, endY: Math.round(h * 0.3) + travelY, durationMs };
    case "left":
      return { startX: Math.round(w * 0.8), startY: midY, endX: Math.round(w * 0.8) - travelX, endY: midY + 6, durationMs };
    case "right":
      return { startX: Math.round(w * 0.2), startY: midY, endX: Math.round(w * 0.2) + travelX, endY: midY - 6, durationMs };
  }
}

const APP_PACKAGES = { tiktok: WATCHED_PACKAGES.tiktok, twitter: WATCHED_PACKAGES.twitter } as const;

/** Gestures whose effect is inside the window: the tree may need a kick to move. */
const IN_WINDOW_GESTURES: ReadonlySet<DeviceInput["action"]> = new Set(["tap", "type", "swipe"]);

/**
 * The field a `type` lands in: the one named by the caller, else the focused
 * EditText of the screen just read. The IME swap steals focus, so the field is
 * clicked again between the swap and the broadcast — the sequence that landed
 * text on every build measured (`engine/actor.ts` `typeIntoField`).
 */
export function typingField(tree: CompactTree, fieldResourceId?: string): TreeNode | null {
  if (fieldResourceId) {
    return tree.nodes.find((n) => n.resourceId === fieldResourceId) ?? null;
  }
  const fields = editTexts(tree.nodes);
  return fields.find((n) => n.focused) ?? (fields.length === 1 ? fields[0] : null);
}

async function perform(dev: DeviceRef, input: DeviceInput, tree: CompactTree): Promise<string> {
  switch (input.action) {
    case "tap": {
      const selector = selectorFor(input);
      if (selector) {
        const clicked = await actOnNode(dev.tunnelHostname, dev.dbId, selector, "click", 1_500);
        if (!clicked) throw new Error("No node matches that selector on the current screen");
        return `tap ${JSON.stringify(selector)}`;
      }
      if (input.x === undefined || input.y === undefined) {
        throw new Error("tap needs coordinates (x, y) or a selector (resource_id, text, content_desc)");
      }
      await shell(dev.tunnelHostname, dev.dbId, `input tap ${input.x} ${input.y}`);
      return `tap ${input.x},${input.y}`;
    }
    case "press":
      await shell(dev.tunnelHostname, dev.dbId, `input keyevent ${KEY_CODES[input.key]}`);
      return `press ${input.key}`;
    case "type": {
      const field = typingField(tree, input.field_resource_id);
      if (!field) {
        throw new Error(
          input.field_resource_id
            ? "The field to type into is not on screen"
            : "No focused text field on screen — tap a field first, or pass field_resource_id",
        );
      }
      // ADBKeyboard only (AGENTS.md hard rule 3); the IME is restored whatever happens.
      const previousIme = await getCurrentIme(dev.tunnelHostname, dev.dbId);
      try {
        await typeIntoField(dev, field, input.text);
      } finally {
        await restoreIme(dev.tunnelHostname, dev.dbId, previousIme);
      }
      return `type ${input.text.length} char(s)`;
    }
    case "open_url":
      await shell(dev.tunnelHostname, dev.dbId, androidDeepLink(input.url, input.app ? APP_PACKAGES[input.app] : undefined));
      return `open_url ${input.url}`;
    case "swipe":
      await scrollBezier(dev.tunnelHostname, dev.dbId, swipeGesture(input.direction, tree.width, tree.height));
      return `swipe ${input.direction}`;
  }
}

export async function deviceInputCore(
  ctx: RequestSession,
  deviceId: string,
  rawInput: unknown,
  options: DeviceInputOptions = {},
): Promise<DeviceInputResult> {
  const parsed = deviceInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  }
  const input = parsed.data;
  try {
    const dev = await resolveRunningDevice(ctx, deviceId);
    const before = await readTree(dev);
    const beforeState = classifyForOperator(before.tree);
    if (isHandsOff(beforeState.state) && !options.overrideReason?.trim()) {
      return {
        error: `Hands off: the screen is a security check (${beforeState.state} — ${beforeState.evidence}). A human decides here; pass override_reason to insist, it is journaled.`,
        screen: describeScreen(dev, before, options.maxNodes ?? DEFAULT_MAX_NODES),
      };
    }

    const performed = await perform(dev, input, before.tree);
    await touchDevicePresence(ctx, dev.deviceId);

    // Read the screen after the gesture. An in-window gesture may leave the
    // 1.1.3 agent's tree stale, so it goes through the freshness rule (a
    // composer with typed text forbids the uiautomator kick); a window
    // change (key, deep link) is read plainly after a beat.
    let after: Awaited<ReturnType<typeof readTreeAfterGesture>>;
    if (IN_WINDOW_GESTURES.has(input.action)) {
      after = await readTreeAfterGesture(dev, {
        previousHash: before.tree.hash,
        expectChange: true,
        noKick: input.action === "type",
        settleMs: 800,
      });
    } else {
      await sleep(800);
      after = { ...(await readTree(dev)), stale: false };
    }
    const screenshot = options.includeScreenshot ? await fetchScreenshotJpeg(dev.tunnelHostname, dev.dbId) : undefined;

    await audit(createAdminClient(), {
      actorType: "user",
      actorId: ctx.session.profile.id,
      accountId: dev.accountId ?? ctx.session.profile.account_id ?? null,
      action: `operator.input.${input.action}`,
      targetType: "device",
      targetId: dev.deviceId,
      detail: {
        client: options.client ?? null,
        performed,
        before: beforeState.state,
        after: classifyForOperator(after.tree).state,
        ...(options.overrideReason ? { override_reason: options.overrideReason } : {}),
      },
    });

    return {
      error: null,
      performed,
      stale: after.stale,
      screen: describeScreen(dev, after, options.maxNodes ?? DEFAULT_MAX_NODES, screenshot),
    };
  } catch (err) {
    if (err instanceof TreeUnreadableError) {
      return { error: "The device's accessibility tree is unreadable right now (booting, or the agent is down). Retry in a few seconds." };
    }
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}
