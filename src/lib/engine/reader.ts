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
 * Force the accessibility cache to refresh. `uiautomator dump` is the only
 * trigger proven on 1.1.3 (3/3, 3–12 s). It collapses TikTok's comment
 * composer, so callers never kick while a composer holds text — they verify
 * through a window transition instead (see `verifier`).
 */
export async function kickAccessibilityTree(dev: DeviceRef): Promise<void> {
  await shellSafe(dev.tunnelHostname, dev.dbId, `uiautomator dump ${KICK_FILE} >/dev/null 2>&1; rm -f ${KICK_FILE}`);
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

/**
 * Read after a gesture, refreshing when the tree did not move although it
 * should have. First a short wait and a re-read (enough on 1.1.1 most of the
 * time — but a sheet opening was still stale after 3 s on 44.8.3); if the
 * tree is still identical, the cache is kicked unless forbidden. On the 1.1.3
 * line the kick comes first, since waiting never helps there. With `noKick`
 * the caller gets the stale tree flagged as such and verifies through a
 * window transition.
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
  const attempts: Array<"wait" | "kick"> = treeGoesStaleAfterGestures(dev) ? ["kick"] : ["wait", "kick"];
  for (const attempt of attempts) {
    if (attempt === "kick") {
      if (opts.noKick) break;
      await kickAccessibilityTree(dev);
    } else {
      await sleep(EMPTY_TREE_RETRY_MS);
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
