/**
 * The engine's hands. Every gesture goes through a named target resolved in
 * the tree just read (`selectors`), never through a hard-coded coordinate;
 * the one exception is `tapNode`, for nodes the agent cannot address by
 * selector (no resource id, no text, no description), which taps the node's
 * own centre read from the same tree.
 *
 * Typing is ADBKeyboard only (AGENTS.md hard rule 3); this module exposes no
 * other way to put text in a field.
 */

import { actOnNode, scrollBezier, shell, type V2Selector } from "@/lib/box-api";
import {
  activateAdbKeyboard,
  androidDeepLink,
  typeText,
} from "@/lib/automation/adb-helpers";
import type { DeviceRef } from "./device";
import { nodeCenter, type CompactTree, type TreeNode } from "./ui/compact-tree";
import {
  resolveInTree,
  xpathString,
  type SelectorCandidate,
  type SelectorContext,
  type SelectorKey,
} from "./ui/selectors";

export interface ClickResult {
  clicked: boolean;
  /** How the node was reached, for the step journal. */
  via: "selector" | "tap" | "none";
  node: TreeNode | null;
  selector: V2Selector | null;
}

const CLICK_WAIT_MS = 1_500;

/**
 * Click a named target present in `tree`. Returns `clicked: false` (without a
 * device round-trip) when the target is not on screen — the recipe decides
 * whether that is an obstacle or a normal branch.
 */
export async function clickTarget(
  dev: DeviceRef,
  tree: CompactTree,
  key: SelectorKey,
  ctx: SelectorContext,
  extra: readonly SelectorCandidate[] = [],
): Promise<ClickResult> {
  const target = resolveInTree(key, tree, ctx, extra);
  if (!target) return { clicked: false, via: "none", node: null, selector: null };

  if (target.selector) {
    const ok = await actOnNode(dev.tunnelHostname, dev.dbId, target.selector, "click", CLICK_WAIT_MS);
    if (ok) return { clicked: true, via: "selector", node: target.node, selector: target.selector };
  }
  const tapped = await tapNode(dev, target.node);
  return { clicked: tapped, via: tapped ? "tap" : "none", node: target.node, selector: target.selector };
}

/** Click a node already chosen from the tree (posted item, dismiss button). */
export async function clickNode(dev: DeviceRef, node: TreeNode): Promise<ClickResult> {
  const selector = selectorForNode(node);
  if (selector) {
    const ok = await actOnNode(dev.tunnelHostname, dev.dbId, selector, "click", CLICK_WAIT_MS);
    if (ok) return { clicked: true, via: "selector", node, selector };
  }
  const tapped = await tapNode(dev, node);
  return { clicked: tapped, via: tapped ? "tap" : "none", node, selector };
}

function selectorForNode(node: TreeNode): V2Selector | null {
  if (node.resourceId) return { xpath: `//*[@resource-id=${xpathString(node.resourceId)}]` };
  if (node.text) return { xpath: `//*[@text=${xpathString(node.text)}]` };
  if (node.contentDesc) return { xpath: `//*[contains(@content-desc,${xpathString(node.contentDesc)})]` };
  return null;
}

/** Tap the centre of a node's bounds — last resort for unaddressable nodes. */
async function tapNode(dev: DeviceRef, node: TreeNode): Promise<boolean> {
  const c = nodeCenter(node);
  if (!c) return false;
  await shell(dev.tunnelHostname, dev.dbId, `input tap ${c.x} ${c.y}`);
  return true;
}

// ---------------------------------------------------------------------------
// Gestures
// ---------------------------------------------------------------------------

export interface ScrollOptions {
  /** Fraction of the screen height travelled (0.3–0.6 reads like a thumb). */
  distance?: number;
  durationMs?: number;
  /** Deterministic jitter source for tests; defaults to Math.random. */
  random?: () => number;
}

/**
 * One human-looking swipe up (next video / next posts): a bezier gesture whose
 * start point, length and speed vary a little every time.
 */
export async function scrollFeed(dev: DeviceRef, tree: CompactTree, opts: ScrollOptions = {}): Promise<void> {
  const rnd = opts.random ?? Math.random;
  const w = tree.width || 1080;
  const h = tree.height || 2340;
  const distance = (opts.distance ?? 0.42 + rnd() * 0.12) * h;
  const startX = w * (0.45 + rnd() * 0.1);
  const startY = h * (0.68 + rnd() * 0.08);
  await scrollBezier(dev.tunnelHostname, dev.dbId, {
    startX,
    startY,
    endX: startX - 5 - rnd() * 20,
    endY: Math.max(h * 0.12, startY - distance),
    durationMs: opts.durationMs ?? 380 + Math.round(rnd() * 160),
  });
}

export async function pressBack(dev: DeviceRef): Promise<void> {
  await shell(dev.tunnelHostname, dev.dbId, "input keyevent 4");
}

export async function pressHome(dev: DeviceRef): Promise<void> {
  await shell(dev.tunnelHostname, dev.dbId, "input keyevent 3");
}

// ---------------------------------------------------------------------------
// Apps
// ---------------------------------------------------------------------------

/**
 * Launch an app from a clean state. `am start MAIN/LAUNCHER` resumes whatever
 * activity the app left (measured: TikTok reopened on a profile), so a recipe
 * that needs the feed force-stops first.
 */
export async function launchApp(
  dev: DeviceRef,
  packageName: string,
  launcherActivity: string,
  opts: { forceStop?: boolean } = {},
): Promise<void> {
  if (opts.forceStop) {
    await shell(dev.tunnelHostname, dev.dbId, `am force-stop ${packageName}`);
    await new Promise((r) => setTimeout(r, 800));
  }
  const component = launcherActivity.includes("/")
    ? launcherActivity
    : `${packageName}/${launcherActivity}`;
  await shell(
    dev.tunnelHostname,
    dev.dbId,
    `am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${component}`,
  );
}

/** Open a post or profile URL in the app that owns it (canonical URL, quoted). */
export async function openDeepLink(dev: DeviceRef, url: string, packageName: string): Promise<void> {
  await shell(dev.tunnelHostname, dev.dbId, androidDeepLink(url, packageName));
}

// ---------------------------------------------------------------------------
// Typing — ADBKeyboard only
// ---------------------------------------------------------------------------

/**
 * Put text in a field through the ADBKeyboard broadcast. The IME swap steals
 * focus, so the field is clicked again between the swap and the broadcast
 * (the sequence that landed text on every build measured). The caller
 * restores the IME afterwards (executor / device session own that lifecycle).
 */
export async function typeIntoField(dev: DeviceRef, field: TreeNode, text: string): Promise<void> {
  await activateAdbKeyboard(dev.tunnelHostname, dev.dbId);
  await clickNode(dev, field);
  await new Promise((r) => setTimeout(r, 800));
  await typeText(dev.tunnelHostname, dev.dbId, text);
}
