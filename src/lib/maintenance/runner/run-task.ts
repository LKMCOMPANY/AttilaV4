import { ContainerNotReadyError } from "@/lib/box-api";
import { TreeUnreadableError } from "@/lib/engine/reader";
import type { createAdminClient } from "@/lib/supabase/admin";
import { broadcastAccountEvent } from "@/lib/supabase/realtime";
import type { MaintenanceTask, MaintenanceTaskKind } from "@/types";
import { openAttention } from "../attention";
import { audit } from "../audit";
import { runAppCheck } from "../recipes/app-check";
import { runCoherence } from "../recipes/coherence";
import type { RecipeContext, RecipeResult } from "../recipes/context";
import { runProbe } from "../recipes/probe";
import { runSocialSession } from "../recipes/social-session";
import { runDismissDialogs, runWarmup } from "../recipes/warmup";
import type { MaintenanceSettings } from "../settings";
import { openDeviceSession } from "./device-session";
import { TaskCancelledError, TaskJournal } from "./journal";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Kinds that only read (launch, classify, list packages): allowed in `observe` mode. */
const OBSERVE_SAFE_KINDS: readonly MaintenanceTaskKind[] = ["probe", "app_check", "coherence", "dismiss_dialogs", "warmup"];

/** Put a task back in the queue this many minutes later when its box has no slot. */
const DEFER_MIN_MINUTES = 8;
const DEFER_MAX_MINUTES = 20;
/** Attempts before a task that keeps failing is given up (each attempt is a claim). */
const MAX_ATTEMPTS = 3;

const RECIPES: Record<MaintenanceTaskKind, (ctx: RecipeContext) => Promise<RecipeResult>> = {
  probe: runProbe,
  warmup: runWarmup,
  dismiss_dialogs: runDismissDialogs,
  coherence: runCoherence,
  app_check: runAppCheck,
  social_session: (ctx) => runSocialSession(ctx),
  relogin: async (ctx) => {
    await ctx.journal.skip("relogin", "phase 2 — not implemented in this build");
    return { outcome: "not_implemented" };
  },
};

export interface RunOutcome {
  taskId: string;
  status: MaintenanceTask["status"];
  outcome: string | null;
}

/**
 * Run one claimed task to its end state. The mode gates gestures (`observe`
 * never opens a session for a `social_session`); the slot arbiter can defer
 * the task; a cancellation from a cockpit stops it at the next step; every
 * other failure is typed into `error_category` and, when it is the device's
 * fault, escalated to the attention queue.
 */
export async function runMaintenanceTask(
  supabase: AdminClient,
  task: MaintenanceTask,
  settings: MaintenanceSettings,
  workerId: string,
): Promise<RunOutcome> {
  const journal = new TaskJournal(supabase, task, workerId, settings.leaseSeconds);

  if (settings.mode === "observe" && !OBSERVE_SAFE_KINDS.includes(task.kind)) {
    await journal.skip(task.kind, "observe mode — planned, not executed");
    return finish(supabase, task, "skipped", "observe_mode", { steps: journal.entries });
  }

  const opened = await openDeviceSession(supabase, task);
  if ("kind" in opened) {
    if (opened.kind === "missing") {
      return finish(supabase, task, "failed", `missing_${opened.what}`, { error_category: "device_setup_required", error_message: `No ${opened.what} for this task` });
    }
    // No slot right now: not an attempt, just later.
    const minutes = DEFER_MIN_MINUTES + Math.random() * (DEFER_MAX_MINUTES - DEFER_MIN_MINUTES);
    await supabase
      .from("maintenance_tasks")
      .update({
        status: "scheduled",
        scheduled_for: new Date(Date.now() + minutes * 60_000).toISOString(),
        attempt: Math.max(0, task.attempt - 1),
        worker_id: null,
        lease_until: null,
        outcome: `deferred_${opened.slot.reason}`,
      })
      .eq("id", task.id);
    return { taskId: task.id, status: "scheduled", outcome: `deferred_${opened.slot.reason}` };
  }

  const session = opened;
  journal.attachDevice(session.dev);
  const ctx: RecipeContext = { supabase, settings, task, session, journal };
  try {
    const result = await RECIPES[task.kind](ctx);
    return await finish(supabase, task, "done", result.outcome, { result: result.result ?? {} });
  } catch (err) {
    return await fail(supabase, task, session.avatar.account_id, session.device.id, err, journal);
  } finally {
    await session.close().catch((closeErr) => {
      console.error(`[Maintenance] session close failed for ${task.id}:`, closeErr instanceof Error ? closeErr.message : closeErr);
    });
  }
}

async function fail(
  supabase: AdminClient,
  task: MaintenanceTask,
  accountId: string,
  deviceId: string,
  err: unknown,
  journal: TaskJournal,
): Promise<RunOutcome> {
  if (err instanceof TaskCancelledError) {
    return finish(supabase, task, "cancelled", "cancelled", {});
  }
  const message = err instanceof Error ? err.message : String(err);
  let category = "unknown";
  if (err instanceof ContainerNotReadyError) category = "device_not_ready";
  else if (err instanceof TreeUnreadableError) category = "tree_unreadable";

  if (category === "device_not_ready") {
    await openAttention(supabase, {
      accountId,
      scope: "device",
      deviceId,
      reason: "boot_dead",
      severity: "warning",
      title: "Le device n'a pas répondu pendant la maintenance",
      detail: message.slice(0, 300),
      evidence: { proof_path: journal.lastProofPath() },
      source: "maintainer",
    });
  }

  // A transient failure gets another attempt later; the third strike is final.
  if (task.attempt < MAX_ATTEMPTS && category !== "unknown") {
    await supabase
      .from("maintenance_tasks")
      .update({
        status: "scheduled",
        scheduled_for: new Date(Date.now() + 15 * 60_000).toISOString(),
        worker_id: null,
        lease_until: null,
        outcome: `retry_${category}`,
        error_category: category,
        error_message: message.slice(0, 500),
      })
      .eq("id", task.id);
    return { taskId: task.id, status: "scheduled", outcome: `retry_${category}` };
  }
  return finish(supabase, task, "failed", category, { error_category: category, error_message: message.slice(0, 500) });
}

async function finish(
  supabase: AdminClient,
  task: MaintenanceTask,
  status: MaintenanceTask["status"],
  outcome: string,
  extra: Record<string, unknown>,
): Promise<RunOutcome> {
  const now = new Date().toISOString();
  await supabase
    .from("maintenance_tasks")
    .update({ status, outcome, finished_at: now, lease_until: null, ...extra })
    .eq("id", task.id);
  await audit(supabase, {
    actorType: "maintainer",
    accountId: task.account_id,
    action: `maintenance.${task.kind}.${status}`,
    targetType: "maintenance_task",
    targetId: task.id,
    detail: { outcome, avatar_id: task.avatar_id, platform: task.platform },
  });
  broadcastAccountEvent(task.account_id, "jobs", { action: "maintenance_task", status, id: task.id });
  return { taskId: task.id, status, outcome };
}

/**
 * Tasks whose lease expired belong to a worker that died: put them back in
 * the queue (or fail them past the attempt budget) so a restart never leaves
 * a device "running" forever.
 */
export async function reclaimExpiredLeases(supabase: AdminClient): Promise<number> {
  const now = new Date().toISOString();
  const { data } = await supabase
    .from("maintenance_tasks")
    .select("id, attempt")
    .eq("status", "running")
    .lt("lease_until", now);
  for (const row of data ?? []) {
    const exhausted = row.attempt >= MAX_ATTEMPTS;
    await supabase
      .from("maintenance_tasks")
      .update(
        exhausted
          ? { status: "failed", outcome: "lease_expired", error_category: "infrastructure", error_message: "Worker lost mid-task (lease expired)", finished_at: now, lease_until: null }
          : { status: "scheduled", outcome: "lease_expired", worker_id: null, lease_until: null, scheduled_for: now },
      )
      .eq("id", row.id)
      .eq("status", "running");
  }
  return data?.length ?? 0;
}
