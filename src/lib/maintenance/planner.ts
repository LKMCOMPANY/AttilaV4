import type { createAdminClient } from "@/lib/supabase/admin";
import type { MaintenanceProfile, MaintenanceTaskKind, SocialPlatform } from "@/types";
import { localDateString, safeTimezone, zonedInstant, localParts } from "./local-time";
import { planDay, type PlannedTask } from "./scheduler";
import { loadMaintenanceSettings, type MaintenanceSettings } from "./settings";

type AdminClient = ReturnType<typeof createAdminClient>;

/** The two platforms the engine drives today; the others have no recipe yet. */
const MAINTAINED_PLATFORMS: readonly SocialPlatform[] = ["tiktok", "twitter"];

interface EnabledAvatarRow {
  id: string;
  account_id: string;
  device_id: string | null;
  maintenance_profile: MaintenanceProfile;
  maintenance_day_zero: string | null;
  tiktok_enabled: boolean;
  twitter_enabled: boolean;
  device: { id: string; timezone: string | null } | null;
}

interface TodayRow {
  platform: SocialPlatform | null;
  kind: MaintenanceTaskKind;
  status: string;
  scheduled_for: string;
}

export interface PlanReport {
  avatars: number;
  planned: number;
  skipped: { noDevice: number; noPlatform: number };
}

/**
 * The Schedule worker: for every avatar with maintenance on, ask the planner
 * what today still needs and insert it — idempotently (a kind already
 * scheduled or done today for the same account/platform is not inserted
 * twice). Runs every half hour; the planner itself never plans the past.
 *
 * `observe` mode plans like the others: the runner is what withholds gestures,
 * so the operator can see in the queue exactly what WOULD run.
 */
export async function planMaintenance(supabase: AdminClient, now = new Date()): Promise<PlanReport> {
  const settings = await loadMaintenanceSettings(supabase);
  const report: PlanReport = { avatars: 0, planned: 0, skipped: { noDevice: 0, noPlatform: 0 } };
  if (!settings.globalEnabled) return report;

  const { data: avatars, error } = await supabase
    .from("avatars")
    .select(
      "id, account_id, device_id, maintenance_profile, maintenance_day_zero, tiktok_enabled, twitter_enabled, device:devices(id, timezone)",
    )
    .eq("maintenance_enabled", true)
    .eq("status", "active")
    .is("archived_at", null);
  if (error) throw new Error(`avatars: ${error.message}`);

  for (const raw of avatars ?? []) {
    const avatar = raw as unknown as EnabledAvatarRow;
    report.avatars++;
    if (!avatar.device) {
      report.skipped.noDevice++;
      continue;
    }
    const platforms = MAINTAINED_PLATFORMS.filter((p) => (p === "tiktok" ? avatar.tiktok_enabled : avatar.twitter_enabled));
    if (platforms.length === 0) {
      report.skipped.noPlatform++;
      continue;
    }
    for (const platform of platforms) {
      report.planned += await planAvatarPlatform(supabase, settings, avatar, platform, now);
    }
  }
  return report;
}

async function planAvatarPlatform(
  supabase: AdminClient,
  settings: MaintenanceSettings,
  avatar: EnabledAvatarRow,
  platform: SocialPlatform,
  now: Date,
): Promise<number> {
  const tz = safeTimezone(avatar.device?.timezone);
  const today = localParts(now, tz);
  const dayStart = zonedInstant(tz, { ...today, hour: 0, minute: 0 });
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  // Today's rows are read for the whole avatar: sessions and probes are per
  // platform, but app_check and coherence are about the DEVICE — planned
  // once a day however many accounts the avatar operates (10 September: a
  // two-platform avatar got both checks twice a day).
  const [{ data: todayRows }, { data: state }, { data: lastChecks }] = await Promise.all([
    supabase
      .from("maintenance_tasks")
      .select("platform, kind, status, scheduled_for")
      .eq("avatar_id", avatar.id)
      .gte("scheduled_for", dayStart.toISOString())
      .lt("scheduled_for", dayEnd.toISOString())
      .neq("status", "cancelled"),
    supabase
      .from("avatar_platform_state")
      .select("probed_at, last_session_at, on_device_status")
      .eq("avatar_id", avatar.id)
      .eq("platform", platform)
      .maybeSingle(),
    supabase
      .from("maintenance_tasks")
      .select("kind, platform, finished_at")
      .eq("avatar_id", avatar.id)
      .in("status", ["done", "failed"])
      .in("kind", ["app_check", "coherence", "relogin"])
      .order("finished_at", { ascending: false })
      .limit(30),
  ]);

  const allRows = (todayRows ?? []) as TodayRow[];
  const rows = allRows.filter((r) => r.platform === platform);
  const sessionsToday = rows.filter((r) => r.kind === "social_session" && r.status !== "failed").map((r) => new Date(r.scheduled_for));
  const probedToday = rows.some((r) => (r.kind === "probe" || r.kind === "warmup") && r.status !== "failed");
  const lastOf = (kind: MaintenanceTaskKind) => {
    // Device-level checks count whatever platform ran them; a re-login is per account.
    const hit = (lastChecks ?? []).find((r) => r.kind === kind && r.finished_at && (kind !== "relogin" || r.platform === platform));
    return hit ? new Date(hit.finished_at as string) : null;
  };

  const plan = planDay({
    now,
    timezone: tz,
    profile: avatar.maintenance_profile,
    dayZero: avatar.maintenance_day_zero,
    budget: settings.budgets[avatar.maintenance_profile],
    activeHours: settings.activeHours,
    sessionsToday,
    probedToday,
    lastSessionAt: state?.last_session_at ? new Date(state.last_session_at) : null,
    lastProbeAt: state?.probed_at ? new Date(state.probed_at) : null,
    lastAppCheckAt: lastOf("app_check"),
    lastCoherenceAt: lastOf("coherence"),
    probeEveryHours: settings.probeEveryHours,
    appCheckEveryDays: settings.appCheckEveryDays,
    onDeviceStatus: state?.on_device_status ?? null,
    lastReloginAt: lastOf("relogin"),
    reloginCooldownHours: settings.reloginCooldownHours,
  });

  // Weekly checks already on the books today (any status but failed, any
  // platform) are not re-planned either — the planner cannot see them through
  // its inputs. Probes and re-logins stay per platform.
  const deviceKinds = new Set<MaintenanceTaskKind>(["app_check", "coherence"]);
  const alreadyToday = new Set(
    allRows.filter((r) => r.status !== "failed" && (deviceKinds.has(r.kind) || r.platform === platform)).map((r) => r.kind),
  );
  const fresh = plan.filter((t) => t.kind === "social_session" || !alreadyToday.has(t.kind));
  if (fresh.length === 0) return 0;

  const { error } = await supabase.from("maintenance_tasks").insert(
    fresh.map((task: PlannedTask) => ({
      account_id: avatar.account_id,
      avatar_id: avatar.id,
      device_id: avatar.device?.id ?? null,
      platform,
      kind: task.kind,
      priority: task.priority,
      scheduled_for: task.scheduledFor.toISOString(),
      params: { ...task.params, local_date: localDateString(task.scheduledFor, tz) },
      created_by: "scheduler",
    })),
  );
  if (error) {
    console.error(`[Maintenance] plan insert failed for ${avatar.id}/${platform}: ${error.message}`);
    return 0;
  }
  return fresh.length;
}
