/**
 * The handle every engine primitive takes: which box, which container, and
 * what the engine already knows about the guest.
 */

export interface DeviceRef {
  tunnelHostname: string;
  dbId: string;
  /** `devices.id`, when the caller has it (ledger, proofs, heartbeat). */
  deviceId?: string;
  /**
   * Control API v2 line (`"1.1.1"` / `"1.1.3"`). Decides how the reader
   * refreshes the accessibility tree after a gesture. `null` until probed.
   */
  agentLine?: string | null;
  /** Device locale (`en-GB`) for locale-bound selectors. */
  locale?: string | null;
}

/** The agent line whose tree goes stale after in-window changes (measured 9/09). */
const STALE_TREE_AGENT_LINE = "1.1.3";

export function treeGoesStaleAfterGestures(dev: DeviceRef): boolean {
  return dev.agentLine === STALE_TREE_AGENT_LINE;
}
