/**
 * Failure taxonomy of a maintenance task, as the operator sees it (a coloured
 * badge, AGENTS.md rule 7). `unknown` is the residue nobody has explained yet
 * and must stay small: the 30 untyped failures of 18–25 September 2026 all
 * fell into the three infrastructure classes named here.
 */

import { ContainerNotReadyError } from "@/lib/box-api";
import { TreeUnreadableError } from "@/lib/engine/reader";

/**
 * Every failure a recipe can raise, typed. `unknown` is the residue nobody
 * has explained yet — AGENTS.md rule 7 says it must stay small; the 30
 * untyped failures of 18–25 September 2026 all fell into the three
 * infrastructure classes below and are now named.
 */
export type FailureCategory =
  | "device_not_ready"
  | "tree_unreadable"
  /** The v2 agent route is stale after a container (re)start: `dial tcp 172.17.0.x:18185: no route to host | connection refused`. */
  | "agent_unreachable"
  /** The container stopped under the session (`instance not running, current state: stopped|stopping`). */
  | "container_stopped"
  /** Tunnel / box transport: Cloudflare 5xx, `Box API timeout`. */
  | "box_unreachable"
  | "unknown";

/** Transient by nature — another attempt later is worth it; the third strike is final. */
export const RETRYABLE_CATEGORIES = new Set<FailureCategory>([
  "device_not_ready",
  "tree_unreadable",
  "agent_unreachable",
  "container_stopped",
  "box_unreachable",
]);

/** Pure — what the message and the error class say about the cause. */
export function categorizeFailure(err: unknown): FailureCategory {
  if (err instanceof ContainerNotReadyError) return "device_not_ready";
  if (err instanceof TreeUnreadableError) return "tree_unreadable";
  const message = err instanceof Error ? err.message : String(err);
  if (/dial tcp [\d.]+:18185: connect: (no route to host|connection refused)/i.test(message)) return "agent_unreachable";
  if (/instance not running, current state: (stopped|stopping|exited)/i.test(message)) return "container_stopped";
  if (/Box API (timeout|error: 5\d\d)|\b5\d\d Bad Gateway|error code: 1033|fetch failed/i.test(message)) return "box_unreachable";
  return "unknown";
}
