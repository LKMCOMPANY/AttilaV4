/**
 * Reconcile `devices.state` with what a box reports in `list_names`.
 *
 * One implementation for the reconcile worker and the admin Sync, where two
 * used to disagree: the worker never marked a device `removed` (a ghost row —
 * `EDGEOFXMNKGJR87N` on box-1 — survived every pass), the Sync did.
 *
 *   - listed as running/starting, DB says otherwise → `running`, fresh last_seen
 *   - listed as stopped, DB says running            → `stopped`
 *   - not listed at all, DB active                  → `removed` (row kept: it
 *     carries an avatar and a history; `check-drift` and the cockpits show it)
 *   - listed again after `removed`                  → `stopped`
 *
 * Nothing is started or stopped here.
 */

import type { VmosContainer } from "@/lib/box-api";
import { fanOutDeviceStateChange } from "@/lib/devices/access";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface InventoryDeviceRow {
  id: string;
  db_id: string;
  state: string;
  account_id: string | null;
}

export interface InventorySummary {
  markedRunning: number;
  markedStopped: number;
  markedRemoved: number;
  restored: number;
  /** db_ids present on the box with no row in the database. */
  unknownOnBox: string[];
}

export type InventoryChange =
  | { id: string; to: "running" | "stopped" | "removed" | "restored"; account_id: string | null };

/** Pure: which rows change, and to what. */
export function planInventory(rows: InventoryDeviceRow[], list: VmosContainer[]): { changes: InventoryChange[]; unknownOnBox: string[] } {
  const live = new Map(list.map((c) => [c.db_id, String(c.state)]));
  const known = new Set(rows.map((r) => r.db_id));
  const changes: InventoryChange[] = [];
  for (const row of rows) {
    const state = live.get(row.db_id);
    if (state === undefined) {
      if (row.state !== "removed") changes.push({ id: row.id, to: "removed", account_id: row.account_id });
      continue;
    }
    const isLive = state === "running" || state === "starting";
    if (row.state === "removed") changes.push({ id: row.id, to: "restored", account_id: row.account_id });
    else if (isLive && row.state !== "running") changes.push({ id: row.id, to: "running", account_id: row.account_id });
    else if (!isLive && row.state === "running") changes.push({ id: row.id, to: "stopped", account_id: row.account_id });
  }
  return { changes, unknownOnBox: list.map((c) => c.db_id).filter((id) => !known.has(id)) };
}

export async function reconcileDeviceRows(
  supabase: AdminClient,
  boxId: string,
  list: VmosContainer[],
  options: { now?: Date; markRemoved?: boolean; broadcast?: boolean } = {},
): Promise<InventorySummary> {
  const nowIso = (options.now ?? new Date()).toISOString();
  const { data } = await supabase.from("devices").select("id, db_id, state, account_id").eq("box_id", boxId);
  const rows = (data ?? []) as InventoryDeviceRow[];
  const { changes, unknownOnBox } = planInventory(rows, list);
  const summary: InventorySummary = { markedRunning: 0, markedStopped: 0, markedRemoved: 0, restored: 0, unknownOnBox };

  for (const change of changes) {
    if (change.to === "removed" && options.markRemoved === false) continue;
    const state = change.to === "restored" ? "stopped" : change.to;
    await supabase.from("devices").update({ state, last_seen: nowIso }).eq("id", change.id);
    if (options.broadcast !== false) void fanOutDeviceStateChange(boxId, change.account_id);
    if (change.to === "running") summary.markedRunning++;
    else if (change.to === "stopped") summary.markedStopped++;
    else if (change.to === "removed") summary.markedRemoved++;
    else summary.restored++;
  }
  return summary;
}
