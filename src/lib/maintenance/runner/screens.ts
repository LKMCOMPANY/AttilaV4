import { shell } from "@/lib/box-api";
import { clickNode, launchApp, pressBack } from "@/lib/engine/actor";
import type { DeviceRef } from "@/lib/engine/device";
import { readTree, sleep, type TreeRead } from "@/lib/engine/reader";
import {
  classifyScreen,
  findSafeAffordance,
  SAFE_REACTION,
  type Classification,
  type ScreenState,
  type SocialApp,
} from "@/lib/engine/ui/screen-state";
import type { OnDeviceStatus, SocialPlatform } from "@/types";
import { WATCHED_PACKAGES } from "../app-versions.mjs";

/** Platform → the app the engine drives for it. */
export function appFor(platform: SocialPlatform): { app: SocialApp; packageName: string } | null {
  if (platform === "tiktok") return { app: "tiktok", packageName: WATCHED_PACKAGES.tiktok };
  if (platform === "twitter") return { app: "twitter", packageName: WATCHED_PACKAGES.twitter };
  return null;
}

/**
 * `package/info` reports the launcher activity as a string on some agent
 * builds and as an object on others (measured 9/09/2026: a probe crashed on
 * `.includes` of a non-string). Only a plain, non-empty string is trusted;
 * anything else means "let `monkey` resolve the LAUNCHER category".
 */
export function launcherActivityOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["name", "activity", "class_name", "className"]) {
      if (typeof record[key] === "string" && (record[key] as string).length > 0) return record[key] as string;
    }
  }
  return null;
}

/**
 * Bring the app to its entry screen from a clean state. With a known launcher
 * activity the explicit intent is used; otherwise `monkey` resolves the
 * LAUNCHER category itself, which survives activity renames across builds.
 */
export async function openApp(dev: DeviceRef, packageName: string, launcherActivity: string | null): Promise<void> {
  if (launcherActivity) {
    await launchApp(dev, packageName, launcherActivity, { forceStop: true });
    return;
  }
  await shell(dev.tunnelHostname, dev.dbId, `am force-stop ${packageName}`);
  await sleep(800);
  await shell(dev.tunnelHostname, dev.dbId, `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`);
}

export interface SettleResult {
  classification: Classification;
  read: TreeRead;
  /** Dialogs dismissed on the way (their states, in order). */
  dismissed: ScreenState[];
}

/** States a session can proceed from. */
export const MAIN_STATES: readonly ScreenState[] = ["feed_ok", "post_detail", "comments_panel", "profile", "search"];

/** Dialogs cleared in one settle before giving up (a sheet that comes back is not "settling"). */
const SETTLE_MAX_DISMISSALS = 8;
const SETTLE_REREAD_MS = 1_500;
/**
 * How long an app may keep loading before the screen is declared unreadable.
 * Measured 10 September 2026 on box-1: TikTok 44.6 reached its feed after 23 s,
 * a hair under the former 8-round cap (~22 s) that had already called X on
 * US36 unreadable while it was still loading.
 */
const SETTLE_LOADING_MAX_MS = 45_000;
/** Consecutive reads that must agree before an `unknown` screen is believed. */
const UNKNOWN_CONFIRM_READS = 2;

/**
 * Read, classify, and clear what can safely be cleared (a "Not now", a denied
 * permission, the free option of a plan sheet, BACK on a stray sheet) until the
 * app shows a main screen or a state nobody may touch (`stop`: logged out,
 * bouncer, version wall…). Never clicks OK / Allow / Log in / Update.
 *
 * Loading is bounded by time, dismissals by count, and `unknown` needs two
 * reads in a row: right after a launch the first tree is often a screen in
 * transition, not the screen the app ends on.
 */
export async function settleApp(dev: DeviceRef, app: SocialApp): Promise<SettleResult> {
  const dismissed: ScreenState[] = [];
  const startedAt = Date.now();
  let unknownReads = 0;
  let read = await readTree(dev);
  let classification = classifyScreen(read.tree, app);
  for (;;) {
    const reaction = SAFE_REACTION[classification.state];
    if (reaction === "proceed" || reaction === "stop") break;
    unknownReads = reaction === "vision" ? unknownReads + 1 : 0;
    if (reaction === "vision") {
      if (unknownReads >= UNKNOWN_CONFIRM_READS) break;
    } else if (reaction === "reread") {
      if (Date.now() - startedAt >= SETTLE_LOADING_MAX_MS) break;
    } else {
      if (dismissed.length >= SETTLE_MAX_DISMISSALS) break;
      dismissed.push(classification.state);
      const affordance = reaction === "back" ? null : findSafeAffordance(classification.state, read.tree.nodes);
      if (affordance) {
        await clickNode(dev, affordance);
      } else {
        await pressBack(dev);
      }
    }
    await sleep(SETTLE_REREAD_MS);
    read = await readTree(dev);
    classification = classifyScreen(read.tree, app);
  }
  return { classification, read, dismissed };
}

/** What a settled screen says about the account on this device. */
export function statusFromScreen(state: ScreenState): OnDeviceStatus {
  switch (state) {
    case "feed_ok":
    case "post_detail":
    case "comments_panel":
    case "profile":
    case "search":
      return "logged_in";
    case "logged_out":
      return "logged_out";
    case "bouncer":
      return "challenge";
    case "version_wall":
      return "app_outdated";
    case "empty_tree":
    case "loading":
    case "network_error":
      return "unreadable";
    default:
      return "unknown";
  }
}
