import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { MaintenanceBudgets, MaintenanceMode } from "@/types";
import type { ActiveHours } from "./scheduler";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * The maintainer's operating switches, read from `runtime_settings` with
 * validated defaults. Admin-owned; a malformed value falls back to the default
 * rather than stopping the loop.
 */
export interface MaintenanceSettings {
  /** observe = plan and probe, no session gestures; supervised = pilot cohort; autonomous = every enabled avatar. */
  mode: MaintenanceMode;
  globalEnabled: boolean;
  budgets: MaintenanceBudgets;
  activeHours: ActiveHours;
  leaseSeconds: number;
  probeEveryHours: number;
  appCheckEveryDays: number;
  proofRetentionDays: number;
  /** One re-login attempt per account per this many hours. */
  reloginCooldownHours: number;
  /** Let the bounded vision agent try to clear an unknown screen before escalating. */
  visionAgentEnabled: boolean;
  /** TikHub searches per avatar per day for cluster discovery. */
  discoverySearchesPerDay: number;
  /** Chance of liking a video the feed shows, per video, when engagement is allowed. */
  likeProbability: number;
}

const budgetSchema = z.object({
  sessions_per_day: z.number().int().min(0).max(6),
  session_minutes: z.tuple([z.number().min(1).max(60), z.number().min(1).max(60)]),
  likes_per_day: z.number().int().min(0).max(50),
  follows_per_day: z.number().int().min(0).max(20),
});

const SCHEMAS = {
  "maintenance.mode": z.enum(["observe", "supervised", "autonomous"]),
  "maintenance.global_enabled": z.boolean(),
  "maintenance.budgets": z.object({ new: budgetSchema, mature: budgetSchema }),
  "maintenance.active_hours": z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(1).max(24) }),
  "maintenance.lease_seconds": z.number().int().min(60).max(3600),
  "maintenance.probe_every_hours": z.number().min(1).max(168),
  "maintenance.app_check_every_days": z.number().min(1).max(90),
  "maintenance.proof_retention_days": z.number().int().min(1).max(365),
  "maintenance.relogin_cooldown_hours": z.number().min(1).max(168),
  "maintenance.vision_agent_enabled": z.boolean(),
  "maintenance.discovery_searches_per_day": z.number().int().min(0).max(20),
  "maintenance.like_probability": z.number().min(0).max(1),
} as const;

export const DEFAULT_SETTINGS: MaintenanceSettings = {
  mode: "observe",
  globalEnabled: false,
  budgets: {
    new: { sessions_per_day: 1, session_minutes: [3, 6], likes_per_day: 0, follows_per_day: 0 },
    mature: { sessions_per_day: 2, session_minutes: [5, 12], likes_per_day: 6, follows_per_day: 2 },
  },
  activeHours: { start: 8, end: 23 },
  leaseSeconds: 900,
  probeEveryHours: 24,
  appCheckEveryDays: 7,
  proofRetentionDays: 30,
  reloginCooldownHours: 24,
  visionAgentEnabled: false,
  discoverySearchesPerDay: 3,
  likeProbability: 0.15,
};

function pick<K extends keyof typeof SCHEMAS>(
  rows: Map<string, unknown>,
  key: K,
  fallback: z.infer<(typeof SCHEMAS)[K]>,
): z.infer<(typeof SCHEMAS)[K]> {
  const raw = rows.get(key);
  if (raw === undefined) return fallback;
  const parsed = SCHEMAS[key].safeParse(raw);
  if (!parsed.success) {
    console.warn(`[Maintenance] runtime_settings.${key} is malformed — using the default`);
    return fallback;
  }
  return parsed.data as z.infer<(typeof SCHEMAS)[K]>;
}

export async function loadMaintenanceSettings(supabase: AdminClient): Promise<MaintenanceSettings> {
  const { data } = await supabase.from("runtime_settings").select("key, value").like("key", "maintenance.%");
  const rows = new Map<string, unknown>((data ?? []).map((r) => [r.key as string, r.value]));
  const d = DEFAULT_SETTINGS;
  return {
    mode: pick(rows, "maintenance.mode", d.mode),
    globalEnabled: pick(rows, "maintenance.global_enabled", d.globalEnabled),
    budgets: pick(rows, "maintenance.budgets", d.budgets) as MaintenanceBudgets,
    activeHours: pick(rows, "maintenance.active_hours", d.activeHours),
    leaseSeconds: pick(rows, "maintenance.lease_seconds", d.leaseSeconds),
    probeEveryHours: pick(rows, "maintenance.probe_every_hours", d.probeEveryHours),
    appCheckEveryDays: pick(rows, "maintenance.app_check_every_days", d.appCheckEveryDays),
    proofRetentionDays: pick(rows, "maintenance.proof_retention_days", d.proofRetentionDays),
    reloginCooldownHours: pick(rows, "maintenance.relogin_cooldown_hours", d.reloginCooldownHours),
    visionAgentEnabled: pick(rows, "maintenance.vision_agent_enabled", d.visionAgentEnabled),
    discoverySearchesPerDay: pick(rows, "maintenance.discovery_searches_per_day", d.discoverySearchesPerDay),
    likeProbability: pick(rows, "maintenance.like_probability", d.likeProbability),
  };
}
