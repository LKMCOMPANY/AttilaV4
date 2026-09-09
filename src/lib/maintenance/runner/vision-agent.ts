import { generateText, type ModelMessage } from "ai";
import { z } from "zod";
import { parseAleriaJSONWithSchema } from "@/lib/ai/aleria-json";
import { getAleriaModel } from "@/lib/ai/client";
import { fetchScreenshotJpeg } from "@/lib/box-api";
import { clickNode, pressBack, scrollFeed } from "@/lib/engine/actor";
import type { DeviceRef } from "@/lib/engine/device";
import { readTree, sleep, type TreeRead } from "@/lib/engine/reader";
import type { CompactTree, TreeNode } from "@/lib/engine/ui/compact-tree";
import { classifyScreen, type SocialApp } from "@/lib/engine/ui/screen-state";
import { MAIN_STATES } from "./screens";

/**
 * The bounded vision agent (phase 2): when the classifier does not know a
 * screen, a vision model may try to get back to the feed — with a whitelist
 * of moves, a hard step budget, and a loop detector. It never types, never
 * accepts, never logs in, never updates, never pays. Its every move is
 * journaled by the caller; when it gives up, the operator gets the screen.
 */

export const VISION_MAX_STEPS = 12;
/** The same screen seen this many times in a row means the agent is going in circles. */
export const VISION_LOOP_REPEATS = 3;
/** Session 0-A: below ~1 200 output tokens the JSON is cut mid-way. */
const VISION_MAX_TOKENS = 1_200;
const VISION_TIMEOUT_MS = 45_000;
const STEP_SETTLE_MS = 1_500;

export const decisionSchema = z.object({
  action: z.enum(["back", "click", "scroll_down", "wait", "give_up"]),
  label: z.string().max(80).optional(),
  reason: z.string().max(240),
});
export type AgentDecision = z.infer<typeof decisionSchema>;

/** Labels the agent may never click, whatever the model says (word boundaries, any case). */
const FORBIDDEN_LABELS = [
  "ok",
  "allow",
  "accept",
  "agree",
  "continue",
  "log in",
  "login",
  "sign up",
  "sign in",
  "update",
  "install",
  "buy",
  "pay",
  "subscribe",
  "delete",
  "remove",
  "follow",
  "send",
  "post",
  "share",
  "link",
  "verify",
  "confirm",
  "enable",
  "turn on",
];

export interface AgentStepRecord {
  step: number;
  decision: AgentDecision;
  applied: boolean;
  screenState: string;
}

export interface VisionAgentOutcome {
  recovered: boolean;
  steps: AgentStepRecord[];
  reason: "main_screen" | "gave_up" | "loop" | "budget" | "forbidden" | "model_error";
  read: TreeRead;
}

/** A click is applied only on a clickable node whose label is on screen and not forbidden. */
export function pickClickTarget(tree: CompactTree, label: string | undefined): TreeNode | null {
  if (!label) return null;
  const wanted = label.trim().toLowerCase();
  if (!wanted) return null;
  const words = ` ${wanted} `;
  if (FORBIDDEN_LABELS.some((f) => words.includes(` ${f} `) || wanted === f)) return null;
  return (
    tree.nodes.find((n) => n.clickable && n.text.trim().toLowerCase() === wanted) ??
    tree.nodes.find((n) => n.clickable && n.contentDesc.trim().toLowerCase() === wanted) ??
    null
  );
}

/** True when the last `repeats` hashes are all equal (the screen is not moving). */
export function isLooping(hashes: readonly string[], repeats = VISION_LOOP_REPEATS): boolean {
  if (hashes.length < repeats) return false;
  const tail = hashes.slice(-repeats);
  return tail.every((h) => h === tail[0]);
}

/** The visible, clickable labels the model may choose from. */
export function clickableLabels(tree: CompactTree): string[] {
  const labels = new Set<string>();
  for (const n of tree.nodes) {
    if (!n.clickable) continue;
    const label = (n.text || n.contentDesc).trim();
    if (label && label.length <= 80 && pickClickTarget(tree, label)) labels.add(label);
  }
  return [...labels].slice(0, 25);
}

export function buildVisionPrompt(app: SocialApp, labels: string[], history: AgentStepRecord[]): string {
  return [
    `You are helping an automated tester get a ${app === "tiktok" ? "TikTok" : "X"} Android app back to its main feed.`,
    "The screen is attached. Choose ONE move and answer with JSON only:",
    '{"action": "back" | "click" | "scroll_down" | "wait" | "give_up", "label": "<exact visible label when action is click>", "reason": "<one sentence>"}',
    "Rules: never accept, allow, log in, sign up, update, pay, follow, post or verify anything. Prefer dismissing (Not now, Skip, Close, Cancel, ×) or going back.",
    "If the screen asks for credentials, a code, a payment, or shows a security check, answer give_up.",
    labels.length ? `Clickable labels you may use: ${labels.map((l) => `"${l}"`).join(", ")}.` : "No safe clickable label is visible.",
    history.length ? `Moves so far: ${history.map((h) => `${h.step}:${h.decision.action}${h.decision.label ? `(${h.decision.label})` : ""}→${h.screenState}`).join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function decide(dev: DeviceRef, app: SocialApp, tree: CompactTree, history: AgentStepRecord[]): Promise<AgentDecision | null> {
  const image = await fetchScreenshotJpeg(dev.tunnelHostname, dev.dbId, 60);
  const prompt = buildVisionPrompt(app, clickableLabels(tree), history);
  const content: ModelMessage["content"] = image.length > 0
    ? [{ type: "text", text: prompt }, { type: "image", image, mediaType: "image/jpeg" }]
    : [{ type: "text", text: prompt }];
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("vision timeout")), VISION_TIMEOUT_MS));
  try {
    const { text } = await Promise.race([
      generateText({ model: getAleriaModel("aleria-vl"), messages: [{ role: "user", content }], maxOutputTokens: VISION_MAX_TOKENS }),
      timeout,
    ]);
    return parseAleriaJSONWithSchema(text, decisionSchema);
  } catch (err) {
    console.error(`[Vision] decision failed on ${dev.dbId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Try to bring the app back to a main screen from an unknown one. Returns
 * the last read and how it ended; the caller journals and escalates.
 */
export async function runVisionAgent(dev: DeviceRef, app: SocialApp, start: TreeRead): Promise<VisionAgentOutcome> {
  const steps: AgentStepRecord[] = [];
  const hashes: string[] = [start.tree.hash];
  let read = start;

  for (let step = 1; step <= VISION_MAX_STEPS; step++) {
    const decision = await decide(dev, app, read.tree, steps);
    if (!decision) return { recovered: false, steps, reason: "model_error", read };
    if (decision.action === "give_up") return { recovered: false, steps, reason: "gave_up", read };

    let applied = true;
    if (decision.action === "back") {
      await pressBack(dev);
    } else if (decision.action === "scroll_down") {
      await scrollFeed(dev, read.tree);
    } else if (decision.action === "click") {
      const target = pickClickTarget(read.tree, decision.label);
      if (!target) {
        steps.push({ step, decision, applied: false, screenState: "forbidden" });
        return { recovered: false, steps, reason: "forbidden", read };
      }
      await clickNode(dev, target);
    } else {
      applied = false;
    }
    await sleep(STEP_SETTLE_MS);
    read = await readTree(dev);
    const state = classifyScreen(read.tree, app).state;
    steps.push({ step, decision, applied, screenState: state });
    if (MAIN_STATES.includes(state)) return { recovered: true, steps, reason: "main_screen", read };
    hashes.push(read.tree.hash);
    if (isLooping(hashes)) return { recovered: false, steps, reason: "loop", read };
  }
  return { recovered: false, steps, reason: "budget", read };
}
