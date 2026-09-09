/**
 * Maintenance cores — the same logic behind the web Server Actions and the
 * macOS REST routes. Reads ride the caller's RLS-scoped client; mutations go
 * through the service role once the caller's visibility (and, where it
 * matters, role) has been checked. Every mutation is audited.
 */

import type { RequestSession } from "@/lib/auth/session";
import { audit } from "@/lib/maintenance/audit";
import { signProofUrl } from "@/lib/maintenance/runner/proofs";
import { PRIORITY } from "@/lib/maintenance/scheduler";
import { createAdminClient } from "@/lib/supabase/admin";
import { broadcastAccountEvent } from "@/lib/supabase/realtime";
import type {
  AvatarBrief,
  AvatarPlatformState,
  MaintenanceProfile,
  MaintenanceTask,
  MaintenanceTaskKind,
  SocialPlatform,
} from "@/types";

export interface AvatarMaintenanceOverview {
  enabled: boolean;
  profile: MaintenanceProfile;
  dayZero: string | null;
  states: AvatarPlatformState[];
  tasks: MaintenanceTask[];
  brief: AvatarBrief | null;
}

export interface MaintenanceSettingsPatch {
  enabled?: boolean;
  profile?: MaintenanceProfile;
  /** `YYYY-MM-DD`; `null` clears day zero. */
  dayZero?: string | null;
}

type Result<T> = T | { error: string };

const TASK_HISTORY_LIMIT = 40;

/** The avatar as the caller may see it — null when RLS hides it. */
async function visibleAvatar(ctx: RequestSession, avatarId: string): Promise<{ id: string; account_id: string; device_id: string | null } | null> {
  const { data } = await ctx.supabase.from("avatars").select("id, account_id, device_id").eq("id", avatarId).maybeSingle();
  return data ?? null;
}

function canManage(ctx: RequestSession): boolean {
  const role = ctx.session.profile.role;
  return role === "admin" || role === "manager";
}

/** States, recent tasks and the brief of one avatar (RLS-scoped reads). */
export async function getAvatarMaintenanceCore(ctx: RequestSession, avatarId: string): Promise<Result<AvatarMaintenanceOverview>> {
  const { data: avatar } = await ctx.supabase
    .from("avatars")
    .select("id, maintenance_enabled, maintenance_profile, maintenance_day_zero")
    .eq("id", avatarId)
    .maybeSingle();
  if (!avatar) return { error: "Avatar introuvable" };

  const [{ data: states }, { data: tasks }, { data: brief }] = await Promise.all([
    ctx.supabase.from("avatar_platform_state").select("*").eq("avatar_id", avatarId),
    ctx.supabase
      .from("maintenance_tasks")
      .select("*")
      .eq("avatar_id", avatarId)
      .order("scheduled_for", { ascending: false })
      .limit(TASK_HISTORY_LIMIT),
    ctx.supabase.from("avatar_briefs").select("*").eq("avatar_id", avatarId).maybeSingle(),
  ]);
  return {
    enabled: avatar.maintenance_enabled,
    profile: avatar.maintenance_profile as MaintenanceProfile,
    dayZero: avatar.maintenance_day_zero,
    states: (states ?? []) as AvatarPlatformState[],
    tasks: (tasks ?? []) as MaintenanceTask[],
    brief: (brief as AvatarBrief | null) ?? null,
  };
}

/** Switch maintenance on or off, set the profile and day zero (managers and admins). */
export async function setAvatarMaintenanceCore(
  ctx: RequestSession,
  avatarId: string,
  patch: MaintenanceSettingsPatch,
): Promise<Result<{ ok: true }>> {
  if (!canManage(ctx)) return { error: "Réservé aux administrateurs et managers" };
  const avatar = await visibleAvatar(ctx, avatarId);
  if (!avatar) return { error: "Avatar introuvable" };

  const update: Record<string, unknown> = {};
  if (patch.enabled !== undefined) update.maintenance_enabled = patch.enabled;
  if (patch.profile !== undefined) update.maintenance_profile = patch.profile;
  if (patch.dayZero !== undefined) update.maintenance_day_zero = patch.dayZero;
  if (patch.enabled && patch.profile === "new" && patch.dayZero === undefined) {
    // A new account switched on without a day zero starts today.
    update.maintenance_day_zero = new Date().toISOString().slice(0, 10);
  }
  if (Object.keys(update).length === 0) return { ok: true };

  const admin = createAdminClient();
  const { error } = await admin.from("avatars").update(update).eq("id", avatarId);
  if (error) return { error: error.message };
  if (patch.enabled === false) {
    await admin.from("maintenance_tasks").update({ status: "cancelled", outcome: "maintenance_disabled" }).eq("avatar_id", avatarId).eq("status", "scheduled");
  }
  await audit(admin, {
    actorType: "user",
    actorId: ctx.session.profile.id,
    accountId: avatar.account_id,
    action: "maintenance.settings",
    targetType: "avatar",
    targetId: avatarId,
    detail: update,
  });
  broadcastAccountEvent(avatar.account_id, "jobs", { action: "maintenance_settings", id: avatarId });
  return { ok: true };
}

/** Queue a probe (or another read-only check) right now, ahead of the day's plan. */
export async function requestMaintenanceTaskNowCore(
  ctx: RequestSession,
  avatarId: string,
  kind: Extract<MaintenanceTaskKind, "probe" | "app_check" | "coherence" | "dismiss_dialogs">,
  platform: SocialPlatform | null,
): Promise<Result<{ taskId: string }>> {
  const avatar = await visibleAvatar(ctx, avatarId);
  if (!avatar) return { error: "Avatar introuvable" };
  if (!avatar.device_id) return { error: "Aucun device attaché à cet avatar" };
  if ((kind === "probe" || kind === "dismiss_dialogs") && !platform) return { error: "Plateforme requise" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("maintenance_tasks")
    .insert({
      account_id: avatar.account_id,
      avatar_id: avatarId,
      device_id: avatar.device_id,
      platform,
      kind,
      priority: PRIORITY.warmup + 10,
      scheduled_for: new Date().toISOString(),
      params: { requested_by: ctx.session.profile.id },
      created_by: "operator",
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Insertion impossible" };
  await audit(admin, {
    actorType: "user",
    actorId: ctx.session.profile.id,
    accountId: avatar.account_id,
    action: "maintenance.request",
    targetType: "maintenance_task",
    targetId: data.id,
    detail: { kind, platform, avatar_id: avatarId },
  });
  broadcastAccountEvent(avatar.account_id, "jobs", { action: "maintenance_task", status: "scheduled", id: data.id });
  return { taskId: data.id };
}

/** Cancel a scheduled or running task; the runner stops at its next step. */
export async function cancelMaintenanceTaskCore(ctx: RequestSession, taskId: string): Promise<Result<{ ok: true }>> {
  const { data: task } = await ctx.supabase.from("maintenance_tasks").select("id, account_id, status").eq("id", taskId).maybeSingle();
  if (!task) return { error: "Tâche introuvable" };
  if (task.status !== "scheduled" && task.status !== "running") return { error: "Cette tâche est déjà terminée" };
  const admin = createAdminClient();
  await admin.from("maintenance_tasks").update({ status: "cancelled", outcome: "cancelled_by_operator" }).eq("id", taskId).in("status", ["scheduled", "running"]);
  await audit(admin, {
    actorType: "user",
    actorId: ctx.session.profile.id,
    accountId: task.account_id,
    action: "maintenance.cancel",
    targetType: "maintenance_task",
    targetId: taskId,
  });
  broadcastAccountEvent(task.account_id, "jobs", { action: "maintenance_task", status: "cancelled", id: taskId });
  return { ok: true };
}

/**
 * A short-lived URL for a proof the caller may see: the path starts with an
 * account id, and the caller must be that account's member (or an admin).
 */
export async function signMaintenanceProofCore(ctx: RequestSession, path: string): Promise<Result<{ url: string; expiresAt: string }>> {
  const accountId = path.split("/")[0];
  const isAdmin = ctx.session.profile.role === "admin";
  if (!accountId || (!isAdmin && ctx.session.profile.account_id !== accountId)) return { error: "Preuve introuvable" };
  if (path.includes("..") || !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[\w.-]+$/i.test(path)) return { error: "Chemin invalide" };
  const signed = await signProofUrl(createAdminClient(), path);
  return signed ?? { error: "Preuve introuvable" };
}
