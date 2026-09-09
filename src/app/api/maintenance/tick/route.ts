import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reclaimExpiredLeases, runMaintenanceTask } from "@/lib/maintenance/runner/run-task";
import { loadMaintenanceSettings } from "@/lib/maintenance/settings";
import type { MaintenanceTask } from "@/types";

/**
 * POST /api/maintenance/tick
 *
 * One beat of the Maintain loop: reclaim the leases of dead workers, claim
 * the most urgent due task (`claim_maintenance_task`, FOR UPDATE SKIP LOCKED),
 * run it to its end state, answer. `idle` when the queue is empty or the
 * layer is switched off (`runtime_settings.maintenance.global_enabled`).
 * A long-running session extends its lease from the step journal. Driven by
 * the Maintain worker loops in server.mjs; protected by CRON_SECRET.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const settings = await loadMaintenanceSettings(supabase);
  if (!settings.globalEnabled) {
    return NextResponse.json({ action: "idle", message: "Maintenance disabled" });
  }

  const reclaimed = await reclaimExpiredLeases(supabase);
  const workerId = `${process.env.RENDER_INSTANCE_ID ?? "local"}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;

  const { data, error } = await supabase.rpc("claim_maintenance_task", {
    p_worker: workerId,
    p_lease_seconds: settings.leaseSeconds,
  });
  if (error) {
    console.error(`[Maintain] claim failed: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const task = (Array.isArray(data) ? data[0] : data) as MaintenanceTask | undefined;
  if (!task) {
    return NextResponse.json({ action: "idle", message: "No due task", reclaimed });
  }

  console.log(`[Maintain] Claimed ${task.kind} ${task.id}`, JSON.stringify({ avatar: task.avatar_id, platform: task.platform, attempt: task.attempt, mode: settings.mode }));
  const outcome = await runMaintenanceTask(supabase, task, settings, workerId);
  console.log(`[Maintain] ${task.kind} ${task.id} → ${outcome.status} (${outcome.outcome})`);
  return NextResponse.json({ action: "ran", ...outcome, reclaimed });
}
