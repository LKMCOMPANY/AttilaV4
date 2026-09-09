import type { createAdminClient } from "@/lib/supabase/admin";
import type { MaintenanceTask } from "@/types";
import type { TaskJournal } from "../runner/journal";
import type { DeviceSession } from "../runner/device-session";
import type { MaintenanceSettings } from "../settings";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Everything a recipe needs: the open device session, the journal, the switches. */
export interface RecipeContext {
  supabase: AdminClient;
  settings: MaintenanceSettings;
  task: MaintenanceTask;
  session: DeviceSession;
  journal: TaskJournal;
}

export interface RecipeResult {
  /** Short machine word for `maintenance_tasks.outcome` (`logged_in`, `deferred`, `walled`…). */
  outcome: string;
  /** Free-form facts for `maintenance_tasks.result`. */
  result?: Record<string, unknown>;
}

/** Deterministic-friendly jitter: recipes take a random source so tests can pin it. */
export function jitter(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}
