import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchContainerList, fetchHealthz } from "@/lib/box-api";
import { fanOutDeviceStateChange } from "@/lib/devices/access";

/**
 * POST /api/devices/reconcile
 *
 * The database's picture of the fleet is corrected from what every box
 * reports live, so the other workers can trust it:
 *   - a box that answers `/healthz` is `online` (with its uptime and container
 *     count), one that does not is `offline` — the reaper stops calling it;
 *   - a container the box runs while the database says `stopped` becomes
 *     `running` with a fresh `last_seen`, which puts it in front of the reaper
 *     (measured 9/09/2026: GB12 had been running on box-2 for eight days,
 *     invisible to every worker);
 *   - a container the box has stopped while the database says `running`
 *     becomes `stopped`, so its slot is counted free again.
 *
 * Nothing is started or stopped here. Driven by the Reconcile worker loop in
 * server.mjs. Protected by CRON_SECRET.
 */

interface BoxRow {
  id: string;
  tunnel_hostname: string;
  status: "online" | "offline";
}

interface DeviceRow {
  id: string;
  db_id: string;
  state: string;
  account_id: string | null;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: boxes } = await supabase.from("boxes").select("id, tunnel_hostname, status");
  if (!boxes || boxes.length === 0) return NextResponse.json({ action: "idle", boxes: 0 });

  const summary = { boxesOnline: 0, boxesOffline: 0, markedRunning: 0, markedStopped: 0 };
  const nowIso = new Date().toISOString();

  for (const box of boxes as BoxRow[]) {
    let live: Set<string>;
    try {
      const [health, containers] = await Promise.all([
        fetchHealthz(box.tunnel_hostname),
        fetchContainerList(box.tunnel_hostname),
      ]);
      live = new Set(
        containers.list
          .filter((c) => String(c.state) === "running" || String(c.state) === "starting")
          .map((c) => c.db_id),
      );
      await supabase
        .from("boxes")
        .update({
          status: "online",
          uptime_seconds: health.uptime ?? null,
          container_count: containers.list.length,
          last_heartbeat: nowIso,
        })
        .eq("id", box.id);
      summary.boxesOnline++;
    } catch (err) {
      if (box.status !== "offline") {
        console.warn(`[Reconcile] ${box.tunnel_hostname} unreachable — marking offline: ${err instanceof Error ? err.message : err}`);
        await supabase.from("boxes").update({ status: "offline" }).eq("id", box.id);
      }
      summary.boxesOffline++;
      continue;
    }

    const { data: devices } = await supabase
      .from("devices")
      .select("id, db_id, state, account_id")
      .eq("box_id", box.id)
      .neq("state", "removed");

    for (const device of (devices ?? []) as DeviceRow[]) {
      const isLive = live.has(device.db_id);
      if (isLive && device.state !== "running") {
        console.warn(`[Reconcile] ${device.db_id} runs on ${box.tunnel_hostname} while the database said ${device.state}`);
        await supabase.from("devices").update({ state: "running", last_seen: nowIso }).eq("id", device.id);
        void fanOutDeviceStateChange(box.id, device.account_id);
        summary.markedRunning++;
      } else if (!isLive && device.state === "running") {
        await supabase.from("devices").update({ state: "stopped", last_seen: nowIso }).eq("id", device.id);
        void fanOutDeviceStateChange(box.id, device.account_id);
        summary.markedStopped++;
      }
    }
  }

  const changed = summary.markedRunning + summary.markedStopped > 0 || summary.boxesOffline > 0;
  return NextResponse.json({ action: changed ? "reconciled" : "idle", ...summary });
}
