/**
 * Run one maintenance task on one avatar, through the exact production path
 * (queue row → `claim_maintenance_task` → device session → recipe → journal),
 * from a terminal. For QA on a single device and for the pilot's first runs.
 *
 * Usage:
 *   npx tsx scripts/maintenance-task.ts --avatar <uuid> --kind probe --platform tiktok
 *   npx tsx scripts/maintenance-task.ts --avatar <uuid> --kind social_session --platform tiktok --minutes 3
 *   npx tsx scripts/maintenance-task.ts --avatar <uuid> --kind social_session --platform twitter --minutes 5 --engage
 *   npx tsx scripts/maintenance-task.ts --avatar <uuid> --kind app_check
 *
 * Env: .env.local is read when present (Supabase service role, CF Access).
 * Honours `runtime_settings.maintenance.mode` — pass `--mode supervised` to
 * override it for this run only (the database value is untouched). `--engage`
 * orders the likes of a session (a human's order engages in any mode, within
 * the day's budget and the blocks gate). The task row stays in
 * `maintenance_tasks` with its journal and proofs, like any other.
 */

import { loadDotEnvLocal } from "./lib/dotenv.mjs";

async function main() {
  loadDotEnvLocal();
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { loadMaintenanceSettings } = await import("../src/lib/maintenance/settings");
  const { runMaintenanceTask } = await import("../src/lib/maintenance/runner/run-task");
  const { PRIORITY } = await import("../src/lib/maintenance/scheduler");

  const args = process.argv.slice(2);
  const arg = (name: string, fallback?: string) => {
    const idx = args.indexOf(`--${name}`);
    if (idx === -1 || idx + 1 >= args.length) {
      if (fallback !== undefined) return fallback;
      throw new Error(`Missing required argument: --${name}`);
    }
    return args[idx + 1];
  };

  const avatarId = arg("avatar");
  const kind = arg("kind", "probe") as "probe" | "warmup" | "app_check" | "coherence" | "social_session" | "dismiss_dialogs";
  const platform = arg("platform", "") || null;
  const minutes = Number(arg("minutes", "3"));
  const modeOverride = arg("mode", "");
  const engage = args.includes("--engage");

  const supabase = createAdminClient();
  const { data: avatar, error } = await supabase
    .from("avatars")
    .select("id, account_id, device_id, first_name, last_name")
    .eq("id", avatarId)
    .single();
  if (error || !avatar) throw new Error(`avatar ${avatarId}: ${error?.message ?? "not found"}`);
  if (!avatar.device_id) throw new Error("This avatar has no device attached");

  const settings = await loadMaintenanceSettings(supabase);
  if (modeOverride) settings.mode = modeOverride as typeof settings.mode;

  console.log("=== MAINTENANCE TASK ===");
  console.log(`Avatar:   ${avatar.first_name} ${avatar.last_name} (${avatar.id})`);
  console.log(`Kind:     ${kind}${platform ? ` on ${platform}` : ""}`);
  console.log(`Mode:     ${settings.mode}${modeOverride ? " (overridden for this run)" : ""}${engage ? " · engagement ordered" : ""}`);

  const { data: inserted, error: insertError } = await supabase
    .from("maintenance_tasks")
    .insert({
      account_id: avatar.account_id,
      avatar_id: avatar.id,
      device_id: avatar.device_id,
      platform,
      kind,
      priority: PRIORITY.warmup + 20,
      scheduled_for: new Date().toISOString(),
      params: { minutes, requested_by: "scripts/maintenance-task.ts", ...(engage ? { allow_engagement: true } : {}) },
      created_by: "operator",
    })
    .select("id")
    .single();
  if (insertError || !inserted) throw new Error(`insert failed: ${insertError?.message}`);

  // Claim OUR row and only ours (migration 20260925211148 added p_task_id):
  // on 25 September 2026 the unfiltered claim twice returned nothing because
  // another task held the device, and would have left a foreign row `running`
  // had it returned one. The same rules apply — a device already carrying a
  // running task refuses, so the row is cancelled instead of lingering.
  const workerId = `script:${process.pid}`;
  const { data: claimed, error: claimError } = await supabase.rpc("claim_maintenance_task", {
    p_worker: workerId,
    p_lease_seconds: settings.leaseSeconds,
    p_task_id: inserted.id,
  });
  if (claimError) throw new Error(`claim failed: ${claimError.message}`);
  const task = (Array.isArray(claimed) ? claimed[0] : claimed) as { id: string } | undefined;
  if (!task) {
    await supabase
      .from("maintenance_tasks")
      .update({ status: "cancelled", outcome: "cancelled", finished_at: new Date().toISOString(), error_message: "device busy with another task at claim time (scripts/maintenance-task.ts)" })
      .eq("id", inserted.id)
      .eq("status", "scheduled");
    throw new Error(`could not claim ${inserted.id}: another task is running on this device — row cancelled, re-run later`);
  }

  const started = Date.now();
  const outcome = await runMaintenanceTask(supabase, task as never, settings, workerId);
  const { data: final } = await supabase.from("maintenance_tasks").select("status, outcome, error_category, error_message, steps, result").eq("id", task.id).single();

  console.log(`\nStatus:   ${outcome.status} (${outcome.outcome}) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (final?.error_message) console.log(`Error:    [${final.error_category}] ${final.error_message}`);
  console.log("Steps:");
  for (const step of (final?.steps ?? []) as Array<Record<string, unknown>>) {
    console.log(
      `  - ${step.name} · ${step.outcome} · ${step.duration_ms} ms${step.screen_state ? ` · ${step.screen_state}` : ""}${step.detail ? ` · ${step.detail}` : ""}${step.proof_path ? ` · proof ${step.proof_path}` : ""}`,
    );
  }
  console.log(`Result:   ${JSON.stringify(final?.result ?? {})}`);
  console.log(`Task id:  ${task.id}`);
}

main().catch((err) => {
  console.error("maintenance-task failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
