import type { DeviceRef } from "@/lib/engine/device";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { MaintenanceStep, MaintenanceTask } from "@/types";
import { captureProof } from "./proofs";

type AdminClient = ReturnType<typeof createAdminClient>;

/** The operator cancelled the task from a cockpit; the runner stops at the next step. */
export class TaskCancelledError extends Error {
  constructor(taskId: string) {
    super(`Maintenance task ${taskId} was cancelled`);
    this.name = "TaskCancelledError";
  }
}

export interface StepOutcome {
  /** What the screen showed after the step, when the step read it. */
  screenState?: string;
  detail?: string;
  /** Take a screenshot after the step and attach its storage path. */
  proof?: boolean;
}

/**
 * The step journal of one task: every step is timed, described, optionally
 * proven with a screenshot, and written to `maintenance_tasks.steps` at once so
 * a cockpit watching the task sees it move. Each write also extends the lease
 * (a heartbeat) and checks for a cancellation.
 */
export class TaskJournal {
  private readonly steps: MaintenanceStep[] = [];
  private dev: DeviceRef | null = null;

  constructor(
    private readonly supabase: AdminClient,
    private readonly task: Pick<MaintenanceTask, "id" | "account_id" | "avatar_id">,
    private readonly workerId: string,
    private readonly leaseSeconds: number,
  ) {}

  /** Proofs need a device; set once the session is open. */
  attachDevice(dev: DeviceRef): void {
    this.dev = dev;
  }

  get entries(): readonly MaintenanceStep[] {
    return this.steps;
  }

  /** Run one named step; failures are journaled then rethrown. */
  async step<T>(name: string, run: () => Promise<T & Partial<StepOutcome>>): Promise<T> {
    await this.assertNotCancelled();
    const startedAt = Date.now();
    try {
      const result = await run();
      await this.record(name, startedAt, "ok", result);
      return result;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await this.record(name, startedAt, "failed", { detail, proof: !(err instanceof TaskCancelledError) });
      throw err;
    }
  }

  /** Journal a step the recipe decided not to run (mode, budget, state). */
  async skip(name: string, detail: string): Promise<void> {
    await this.record(name, Date.now(), "skipped", { detail });
  }

  private async record(name: string, startedAt: number, outcome: MaintenanceStep["outcome"], meta: Partial<StepOutcome>) {
    const entry: MaintenanceStep = {
      name,
      at: new Date(startedAt).toISOString(),
      duration_ms: Date.now() - startedAt,
      outcome,
    };
    if (meta.screenState) entry.screen_state = meta.screenState;
    if (meta.detail) entry.detail = meta.detail.slice(0, 500);
    if (meta.proof && this.dev) {
      const path = await captureProof(this.supabase, this.dev, {
        accountId: this.task.account_id,
        avatarId: this.task.avatar_id,
        taskId: this.task.id,
        index: this.steps.length + 1,
        name,
      });
      if (path) entry.proof_path = path;
    }
    this.steps.push(entry);
    await this.supabase.from("maintenance_tasks").update({ steps: this.steps }).eq("id", this.task.id);
    await this.supabase.rpc("heartbeat_maintenance_task", {
      p_id: this.task.id,
      p_worker: this.workerId,
      p_lease_seconds: this.leaseSeconds,
    });
  }

  /** The last proof taken, for the attention item that escalates the task. */
  lastProofPath(): string | undefined {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i].proof_path) return this.steps[i].proof_path;
    }
    return undefined;
  }

  private async assertNotCancelled(): Promise<void> {
    const { data } = await this.supabase.from("maintenance_tasks").select("status").eq("id", this.task.id).maybeSingle();
    if (data?.status === "cancelled") throw new TaskCancelledError(this.task.id);
  }
}
