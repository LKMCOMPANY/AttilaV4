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

const SETTLE_MAX_ROUNDS = 8;
const SETTLE_REREAD_MS = 1_500;

/**
 * Read, classify, and clear what can safely be cleared (a "Not now", a denied
 * permission, the free option of a plan sheet, BACK on a stray sheet) until the
 * app shows a main screen or a state nobody may touch (`stop`: logged out,
 * bouncer, version wall…). Never clicks OK / Allow / Log in / Update.
 */
export async function settleApp(dev: DeviceRef, app: SocialApp): Promise<SettleResult> {
  const dismissed: ScreenState[] = [];
  let read = await readTree(dev);
  let classification = classifyScreen(read.tree, app);
  for (let round = 0; round < SETTLE_MAX_ROUNDS; round++) {
    const reaction = SAFE_REACTION[classification.state];
    if (reaction === "proceed" || reaction === "stop" || reaction === "vision") break;
    if (reaction === "reread") {
      await sleep(SETTLE_REREAD_MS);
    } else if (reaction === "back") {
      dismissed.push(classification.state);
      await pressBack(dev);
      await sleep(SETTLE_REREAD_MS);
    } else {
      const affordance = findSafeAffordance(classification.state, read.tree.nodes);
      dismissed.push(classification.state);
      if (affordance) {
        await clickNode(dev, affordance);
      } else {
        await pressBack(dev);
      }
      await sleep(SETTLE_REREAD_MS);
    }
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
