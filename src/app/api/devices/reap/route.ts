import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stopContainer } from "@/lib/box-api";
import { isUnderMaintenance, markBoxUnreachable, type BoxPresenceRow } from "@/lib/boxes/presence";
import { fanOutDeviceStateChange } from "@/lib/devices/access";

/**
 * POST /api/devices/reap
 *
 * Reclaims abandoned containers: devices that are `running` but have NO
 * pending/executing campaign job, NO running maintenance task, AND have not
 * been touched for longer than the idle window (operator streams refresh
 * `last_seen` via the WS heartbeat, so a live session is always fresh).
 * Fleet-wide and tenant-safe — it only stops genuinely idle containers, never
 * one the automator, the maintainer or an operator still uses.
 *
 * Two things measured on 25 September 2026 shaped this version:
 *   - five maintenance sessions died with "instance not running" because the
 *     reaper stopped their container from under them (the session had reused
 *     an already-running container, so `last_seen` was old) — a running
 *     `maintenance_tasks` row now protects its device;
 *   - a box under a maintenance window (firmware flash) is skipped entirely,
 *     and a box that fails at the transport level is reported through the one
 *     presence writer instead of a private `markBoxOffline`.
 *
 * Driven by the Device-Reaper worker loop in server.mjs. Protected by CRON_SECRET.
 */

const REAP_IDLE_MS = parseInt(process.env.DEVICE_REAP_IDLE_MS || "900000", 10); // 15 min

interface IdleRow {
  id: string;
  db_id: string;
  box_id: string;
  account_id: string | null;
  boxes: BoxPresenceRow | null;
}

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
    .select("id, db_id, box_id, account_id, boxes(id, tunnel_hostname, status, maintenance_until, firmware_checked_at)")
    .eq("state", "running")
    .lt("last_seen", cutoff);

  if (!idle || idle.length === 0) {
    return NextResponse.json({ action: "idle", reaped: 0 });
  }
  const candidates = idle as unknown as IdleRow[];
  const ids = candidates.map((d) => d.id);

  // Never reap a device the automator still needs — "needs" means imminent
  // work: a job executing, or a `ready` job already DUE. A device whose only
  // jobs are `ready` in the FUTURE is idle right now and cold-starts later.
  const nowMs = Date.now();
  const [{ data: busyJobs }, { data: busyTasks }] = await Promise.all([
    supabase.from("campaign_jobs").select("device_id, status, scheduled_at").in("device_id", ids).in("status", ["ready", "executing"]),
    supabase.from("maintenance_tasks").select("device_id").in("device_id", ids).eq("status", "running"),
  ]);
  const busyIds = new Set<string>([
    ...(busyJobs ?? [])
      .filter((b) => b.status === "executing" || new Date(b.scheduled_at).getTime() <= nowMs)
      .map((b) => b.device_id as string),
    ...(busyTasks ?? []).map((t) => t.device_id as string),
  ]);

  const targets = candidates.filter((d) => !busyIds.has(d.id));
  let reaped = 0;
  let skippedMaintenance = 0;
  // Boxes whose tunnel is down this cycle: one transport failure and the rest
  // of that box's devices are skipped instead of retried one by one.
  const unreachableBoxes = new Set<string>();

  for (const d of targets) {
    const box = d.boxes;
    if (!box?.tunnel_hostname) continue;
    if (unreachableBoxes.has(d.box_id)) continue;
    if (isUnderMaintenance(box)) {
      skippedMaintenance++;
      continue;
    }

    try {
      await stopContainer(box.tunnel_hostname, d.db_id);
      await supabase.from("devices").update({ state: "stopped", last_seen: new Date().toISOString() }).eq("id", d.id);
      await fanOutDeviceStateChange(d.box_id, d.account_id);
      reaped++;
      console.log(`[Reaper] stopped idle device ${d.db_id} on ${box.tunnel_hostname}`);
    } catch (err) {
      if (isBoxUnreachable(err)) {
        unreachableBoxes.add(d.box_id);
        const transition = await markBoxUnreachable(supabase, box);
        console.warn(`[Reaper] ${box.tunnel_hostname} unreachable — presence: ${transition}`);
      } else {
        console.error(`[Reaper] failed to stop ${d.db_id}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  return NextResponse.json({
    action: reaped > 0 ? "reaped" : "idle",
    reaped,
    candidates: targets.length,
    protectedByMaintenanceTask: busyTasks?.length ?? 0,
    skippedMaintenanceWindow: skippedMaintenance,
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
