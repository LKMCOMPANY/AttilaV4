import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BOX_PRESENCE_COLUMNS, observeBox, type BoxPresenceRow } from "@/lib/boxes/presence";
import { reconcileDeviceRows } from "@/lib/boxes/device-inventory";

/**
 * POST /api/devices/reconcile
 *
 * The database's picture of the fleet is corrected from what every box
 * reports live, so the other workers can trust it. One writer for the box
 * (`observeBox` — status, observed lan_ip, uptime, container count, host
 * sample, firmware facts once an hour) and one for the devices
 * (`reconcileDeviceRows` — running / stopped / removed / restored):
 *   - a box that answers `/healthz` is `online`, one that does not is
 *     `offline` — unless its maintenance window is open, in which case its
 *     status is held (a firmware reboot is not an outage);
 *   - a container the box runs while the database says `stopped` becomes
 *     `running` with a fresh `last_seen` (measured 9/09/2026: GB12 had been
 *     running on box-2 for eight days, invisible to every worker);
 *   - a container the box has stopped while the database says `running`
 *     becomes `stopped`, so its slot is counted free again;
 *   - a row the box no longer lists becomes `removed` (kept, flagged), and
 *     comes back as `stopped` if the container reappears.
 *
 * Nothing is started or stopped here. Driven by the Reconcile worker loop in
 * server.mjs. Protected by CRON_SECRET.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: boxes } = await supabase.from("boxes").select(BOX_PRESENCE_COLUMNS);
  if (!boxes || boxes.length === 0) return NextResponse.json({ action: "idle", boxes: 0 });

  const summary = {
    boxesOnline: 0,
    boxesOffline: 0,
    boxesHeld: 0,
    markedRunning: 0,
    markedStopped: 0,
    markedRemoved: 0,
    restored: 0,
    unknownOnBox: 0,
  };
  const now = new Date();

  for (const box of boxes as BoxPresenceRow[]) {
    const { decision, observation } = await observeBox(supabase, box, { now });
    if (decision.transition === "held_maintenance") summary.boxesHeld++;
    if (!observation.health) {
      if (decision.transition === "offline") {
        console.warn(`[Reconcile] ${box.tunnel_hostname} unreachable — marked offline`);
      }
      summary.boxesOffline++;
      continue;
    }
    summary.boxesOnline++;

    if (!observation.containers) {
      console.warn(`[Reconcile] ${box.tunnel_hostname}: list_names unavailable — inventory skipped this pass`);
      continue;
    }
    const inventory = await reconcileDeviceRows(supabase, box.id, observation.containers.list, { now });
    if (inventory.markedRunning) console.warn(`[Reconcile] ${box.tunnel_hostname}: ${inventory.markedRunning} container(s) run while the database said otherwise`);
    if (inventory.markedRemoved) console.warn(`[Reconcile] ${box.tunnel_hostname}: ${inventory.markedRemoved} row(s) no longer on the box — marked removed`);
    if (inventory.removalsSuspended) console.warn(`[Reconcile] ${box.tunnel_hostname}: list_names too short to trust (${observation.containers.list.length} listed) — removals skipped this pass`);
    if (inventory.unknownOnBox.length) console.warn(`[Reconcile] ${box.tunnel_hostname}: ${inventory.unknownOnBox.length} container(s) unknown to the database — run the admin Sync`);
    summary.markedRunning += inventory.markedRunning;
    summary.markedStopped += inventory.markedStopped;
    summary.markedRemoved += inventory.markedRemoved;
    summary.restored += inventory.restored;
    summary.unknownOnBox += inventory.unknownOnBox.length;
  }

  const changed =
    summary.markedRunning + summary.markedStopped + summary.markedRemoved + summary.restored > 0 || summary.boxesOffline > 0;
  return NextResponse.json({ action: changed ? "reconciled" : "idle", ...summary });
}
