import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stopContainer } from "@/lib/box-api";
import { fanOutDeviceStateChange } from "@/lib/devices/access";

/**
 * POST /api/devices/reap
 *
 * Reclaims abandoned containers: devices that are `running` but have NO
 * pending/executing campaign job AND have not been touched for longer than the
 * idle window (operator streams refresh `last_seen` via the WS heartbeat, so a
 * live session is always fresh). Fleet-wide and tenant-safe — it only stops
 * genuinely idle containers, never one the automator or an operator still uses.
 *
 * Driven by the Device-Reaper worker loop in server.mjs. Protected by CRON_SECRET.
 */

const REAP_IDLE_MS = parseInt(process.env.DEVICE_REAP_IDLE_MS || "900000", 10); // 15 min

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - REAP_IDLE_MS).toISOString();

  const { data: idle } = await supabase
    .from("devices")
    .select("id, db_id, box_id, account_id, boxes(tunnel_hostname)")
    .eq("state", "running")
    .lt("last_seen", cutoff);

  if (!idle || idle.length === 0) {
    return NextResponse.json({ action: "idle", reaped: 0 });
  }

  // Never reap a device the automator still needs.
  const { data: busy } = await supabase
    .from("campaign_jobs")
    .select("device_id")
    .in("device_id", idle.map((d) => d.id))
    .in("status", ["ready", "executing"]);
  const busyIds = new Set((busy ?? []).map((b) => b.device_id));

  const targets = idle.filter((d) => !busyIds.has(d.id));
  let reaped = 0;

  for (const d of targets) {
    const box = d.boxes as unknown as { tunnel_hostname: string } | null;
    if (!box?.tunnel_hostname) continue;
    try {
      await stopContainer(box.tunnel_hostname, d.db_id);
      await supabase
        .from("devices")
        .update({ state: "stopped", last_seen: new Date().toISOString() })
        .eq("id", d.id);
      await fanOutDeviceStateChange(d.box_id, d.account_id as string | null);
      reaped++;
      console.log(`[Reaper] stopped idle device ${d.db_id} on box ${d.box_id}`);
    } catch (err) {
      console.error(
        `[Reaper] failed to stop ${d.db_id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return NextResponse.json({
    action: reaped > 0 ? "reaped" : "idle",
    reaped,
    candidates: targets.length,
  });
}
