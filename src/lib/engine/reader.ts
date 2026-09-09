/**
 * The engine's eyes: read the accessibility tree, and know when it is lying.
 *
 * Two facts drive this module (phase 0-A, 9 September 2026):
 *   - the host route to the v2 agent can be down while the guest is fine, so
 *     every read falls back to the in-guest agent through the v1 shell;
 *   - on the 1.1.3 agent line the tree served after an in-window change
 *     (scroll, typed text, a like) is the PREVIOUS tree until a window-state
 *     event happens or the accessibility cache is kicked. A read that is
 *     supposed to reflect a gesture is therefore compared by hash with the
 *     read taken before the gesture, and refreshed when identical.
 *
 * "Cannot read" is a failure, never an optimistic pass: an unreadable tree
 * throws `TreeUnreadableError` and the caller stops.
 */

import { fetchDumpCompact, fetchDumpCompactInGuest, shellSafe } from "@/lib/box-api";
import { parseCompactTree, type CompactTree } from "./ui/compact-tree";
import { treeGoesStaleAfterGestures, type DeviceRef } from "./device";

export type TreeSource = "v2" | "in_guest";

export interface TreeRead {
  tree: CompactTree;
  source: TreeSource;
  durationMs: number;
  /** True when the read needed a refresh (kick or re-read) to change. */
  refreshed: boolean;
}

export class TreeUnreadableError extends Error {
  constructor(
    public readonly dbId: string,
    detail: string,
  ) {
    super(`Accessibility tree unreadable on ${dbId}: ${detail}`);
    this.name = "TreeUnreadableError";
  }
}

const EMPTY_TREE_RETRY_MS = 1_000;
const EMPTY_TREE_ATTEMPTS = 2;

async function fetchText(dev: DeviceRef): Promise<{ text: string; source: TreeSource }> {
  try {
    return { text: await fetchDumpCompact(dev.tunnelHostname, dev.dbId), source: "v2" };
  } catch (v2Error) {
    const inGuest = await fetchDumpCompactInGuest(dev.tunnelHostname, dev.dbId);
    if (inGuest === null) {
      const reason = v2Error instanceof Error ? v2Error.message : String(v2Error);
      throw new TreeUnreadableError(dev.dbId, `v2 failed (${reason}) and in-guest fallback returned nothing`);
    }
    return { text: inGuest, source: "in_guest" };
  }
}

/**
 * Read the current tree. An empty payload while an app is on screen happens
 * during launches and heads-up notifications, so it is re-read once before
 * being returned as-is (the classifier then says `empty_tree`).
 */
export async function readTree(dev: DeviceRef): Promise<TreeRead> {
  const start = Date.now();
  let last: { text: string; source: TreeSource } | null = null;
  for (let attempt = 0; attempt < EMPTY_TREE_ATTEMPTS; attempt++) {
    last = await fetchText(dev);
    if (parseCompactTree(last.text).nodes.length > 0) break;
    if (attempt < EMPTY_TREE_ATTEMPTS - 1) await sleep(EMPTY_TREE_RETRY_MS);
  }
  const tree = parseCompactTree(last!.text);
  return { tree, source: last!.source, durationMs: Date.now() - start, refreshed: false };
}

// ---------------------------------------------------------------------------
// Freshness after a gesture
// ---------------------------------------------------------------------------

const KICK_FILE = "/sdcard/.attila_a11y_kick.xml";

/**
 * How to force the accessibility cache to refresh on the 1.1.3 line. Every
 * working trigger is a window-state event (the service only subscribes to
 * `TYPE_WINDOW_STATE_CHANGED`). Measured on box-5, 9 September 2026:
 *   - `statusbar`: expand then collapse the notification shade — 0.57–0.58 s,
 *     refreshed 2/2, no visible side effect once collapsed. The default.
 *   - `uiautomator`: `uiautomator dump` — 2.65 s, refreshed 3/3, but it
 *     collapses TikTok's comment composer. The fallback when the shade did not
 *     do it, and never while a composer holds text (`noKick`).
 * (`input/keyevent [24,25]` also works in 0.37 s but leaves the volume overlay
 * on screenshots for ~3 s and can drift the volume at the extremes — not used.)
 */
export type TreeKick = "statusbar" | "uiautomator";

const KICK_COMMANDS: Record<TreeKick, string> = {
  statusbar: "cmd statusbar expand-notifications; sleep 0.2; cmd statusbar collapse",
  uiautomator: `uiautomator dump ${KICK_FILE} >/dev/null 2>&1; rm -f ${KICK_FILE}`,
};

/** Settle after a kick before reading: the shade needs a beat to collapse. */
const KICK_SETTLE_MS = 1_000;

export async function kickAccessibilityTree(dev: DeviceRef, kick: TreeKick = "statusbar"): Promise<void> {
  await shellSafe(dev.tunnelHostname, dev.dbId, KICK_COMMANDS[kick]);
  await sleep(KICK_SETTLE_MS);
}

export interface FreshReadOptions {
  /** Hash of the tree read BEFORE the gesture; identical = possibly stale. */
  previousHash: string;
  /** Whether the gesture must have changed the tree (a scroll, a like) — else identical is fine. */
  expectChange: boolean;
  /** Forbid the uiautomator kick (a composer with typed text is on screen). */
  noKick?: boolean;
  /** Settle time before the first read. */
  settleMs?: number;
}

type RefreshAttempt = "wait" | TreeKick;

/**
 * Read after a gesture, refreshing when the tree did not move although it
 * should have. First a short wait and a re-read (enough on 1.1.1 most of the
 * time — but a sheet opening was still stale after 3 s on 44.8.3); if the
 * tree is still identical, the cache is kicked unless forbidden — the shade
 * kick first, `uiautomator dump` only if the shade did not do it. On the
 * 1.1.3 line the kicks come first, since waiting never helps there. With
 * `noKick` the caller gets the stale tree flagged as such and verifies through
 * a window transition.
 */
export async function readTreeAfterGesture(
  dev: DeviceRef,
  opts: FreshReadOptions,
): Promise<TreeRead & { stale: boolean }> {
  if (opts.settleMs) await sleep(opts.settleMs);
  const first = await readTree(dev);
  if (!opts.expectChange || first.tree.hash !== opts.previousHash) {
    return { ...first, stale: false };
  }

  let durationMs = first.durationMs;
  let last = first;
  const attempts: RefreshAttempt[] = treeGoesStaleAfterGestures(dev)
    ? ["statusbar", "uiautomator"]
    : ["wait", "statusbar", "uiautomator"];
  for (const attempt of attempts) {
    if (attempt === "wait") {
      await sleep(EMPTY_TREE_RETRY_MS);
    } else {
      if (opts.noKick) break;
      await kickAccessibilityTree(dev, attempt);
    }
    last = await readTree(dev);
    durationMs += last.durationMs;
    if (last.tree.hash !== opts.previousHash) {
      return { ...last, refreshed: true, durationMs, stale: false };
    }
  }
  return { ...last, refreshed: last !== first, durationMs, stale: true };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
