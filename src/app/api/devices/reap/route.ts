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

  // Never reap a device the automator still needs — but "needs" means work
  // that is imminent: a job executing, or a `ready` job already DUE. A device
  // whose only jobs are `ready` but scheduled in the FUTURE (retry backoff /
  // stagger) is genuinely idle right now; keeping its container running just
  // burns an automator slot (the deadlock this backstops). It will cold-start
  // fresh when the job becomes due.
  const nowMs = Date.now();
  const { data: busy } = await supabase
    .from("campaign_jobs")
    .select("device_id, status, scheduled_at")
    .in("device_id", idle.map((d) => d.id))
    .in("status", ["ready", "executing"]);
  const busyIds = new Set(
    (busy ?? [])
      .filter((b) => b.status === "executing" || new Date(b.scheduled_at).getTime() <= nowMs)
      .map((b) => b.device_id),
  );

  const targets = idle.filter((d) => !busyIds.has(d.id));
  let reaped = 0;
  // Boxes whose tunnel is down this cycle. Once one call to a box fails at the
  // transport layer (Cloudflare 5xx / timeout) we skip the rest of that box's
  // devices instead of retrying each one — that per-device retry storm was
  // filling the logs with hundreds of identical 530s every couple of minutes.
  const unreachableBoxes = new Set<string>();

  for (const d of targets) {
    const box = d.boxes as unknown as { tunnel_hostname: string } | null;
    if (!box?.tunnel_hostname) continue;
    if (unreachableBoxes.has(d.box_id)) continue;

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
      if (isBoxUnreachable(err)) {
        unreachableBoxes.add(d.box_id);
        await markBoxOffline(supabase, d.box_id, box.tunnel_hostname);
      } else {
        console.error(
          `[Reaper] failed to stop ${d.db_id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return NextResponse.json({
    action: reaped > 0 ? "reaped" : "idle",
    reaped,
    candidates: targets.length,
    unreachableBoxes: unreachableBoxes.size,
  });
}

/**
 * A box is "unreachable" when the tunnel origin is down — Cloudflare returns
 * 5xx (commonly 530), or the request times out / DNS fails. These are box-wide,
 * not device-specific, so the reaper should skip the whole box for this cycle.
 */
function isBoxUnreachable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(5\d\d)\b/.test(msg) || /timeout|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(msg);
}

/**
 * Reflect an unreachable box in the dashboard and log it once per cycle
 * instead of once per orphaned device. `last_heartbeat` is left untouched so
 * the gateway sync remains the source of truth for recovery.
 */
async function markBoxOffline(
  supabase: ReturnType<typeof createAdminClient>,
  boxId: string,
  tunnelHostname: string,
): Promise<void> {
  console.warn(`[Reaper] box ${tunnelHostname} unreachable — skipping its idle devices this cycle`);
  await supabase.from("boxes").update({ status: "offline" }).eq("id", boxId);
}
