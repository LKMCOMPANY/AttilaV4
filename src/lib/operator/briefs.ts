/**
 * Brief cores: the army's cluster objective (managers and admins write it),
 * and the effective brief compiled per avatar by Aleria. Web Server Actions
 * and macOS REST routes share these.
 */

import { isManager } from "@/lib/auth/permissions";
import type { RequestSession } from "@/lib/auth/session";
import { audit } from "@/lib/maintenance/audit";
import { compileAvatarBrief } from "@/lib/maintenance/brief";
import { createAdminClient } from "@/lib/supabase/admin";
import { broadcastAccountEvent } from "@/lib/supabase/realtime";
import type { ArmyBrief, AvatarBrief } from "@/types";

type Result<T> = T | { error: string };

const MAX_OBJECTIVE_CHARS = 2_000;
const MAX_KEYWORDS = 30;

async function visibleArmy(ctx: RequestSession, armyId: string): Promise<{ id: string; account_id: string; name: string } | null> {
  const { data } = await ctx.supabase.from("armies").select("id, account_id, name").eq("id", armyId).maybeSingle();
  return data ?? null;
}

export async function getArmyBriefCore(ctx: RequestSession, armyId: string): Promise<Result<{ brief: ArmyBrief | null }>> {
  const army = await visibleArmy(ctx, armyId);
  if (!army) return { error: "Armée introuvable" };
  const { data } = await ctx.supabase.from("army_briefs").select("*").eq("army_id", armyId).maybeSingle();
  return { brief: (data as ArmyBrief | null) ?? null };
}

export async function setArmyBriefCore(
  ctx: RequestSession,
  armyId: string,
  input: { objective: string; clusterKeywords: string[] },
): Promise<Result<{ brief: ArmyBrief }>> {
  if (!isManager(ctx.session.profile.role)) return { error: "Réservé aux administrateurs et managers" };
  const army = await visibleArmy(ctx, armyId);
  if (!army) return { error: "Armée introuvable" };
  const objective = input.objective.trim().slice(0, MAX_OBJECTIVE_CHARS);
  const keywords = [...new Set(input.clusterKeywords.map((k) => k.trim()).filter(Boolean))].slice(0, MAX_KEYWORDS);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("army_briefs")
    .upsert({ army_id: armyId, objective, cluster_keywords: keywords, updated_by: ctx.session.profile.id }, { onConflict: "army_id" })
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "Enregistrement impossible" };
  await audit(admin, {
    actorType: "user",
    actorId: ctx.session.profile.id,
    accountId: army.account_id,
    action: "brief.army.set",
    targetType: "army",
    targetId: armyId,
    detail: { objective_chars: objective.length, keywords: keywords.length },
  });
  return { brief: data as ArmyBrief };
}

/** Compile the effective brief of every active avatar of the army (managers and admins). */
export async function compileArmyBriefCore(
  ctx: RequestSession,
  armyId: string,
): Promise<Result<{ compiled: number; failed: number }>> {
  if (!isManager(ctx.session.profile.role)) return { error: "Réservé aux administrateurs et managers" };
  const army = await visibleArmy(ctx, armyId);
  if (!army) return { error: "Armée introuvable" };
  const { data: members } = await ctx.supabase
    .from("avatar_armies")
    .select("avatar_id, avatar:avatars!inner(id, archived_at)")
    .eq("army_id", armyId);

  const admin = createAdminClient();
  let compiled = 0;
  let failed = 0;
  for (const row of (members ?? []) as unknown as Array<{ avatar_id: string; avatar: { archived_at: string | null } | null }>) {
    if (row.avatar?.archived_at) continue;
    try {
      await compileAvatarBrief(admin, row.avatar_id, ctx.session.profile.id);
      compiled++;
    } catch (err) {
      failed++;
      console.error(`[Brief] compile failed for ${row.avatar_id}:`, err instanceof Error ? err.message : err);
    }
  }
  await audit(admin, {
    actorType: "user",
    actorId: ctx.session.profile.id,
    accountId: army.account_id,
    action: "brief.army.compile",
    targetType: "army",
    targetId: armyId,
    detail: { compiled, failed },
  });
  broadcastAccountEvent(army.account_id, "jobs", { action: "briefs_compiled", id: armyId });
  return { compiled, failed };
}

/** Compile one avatar's effective brief (any member who can see the avatar). */
export async function compileAvatarBriefCore(ctx: RequestSession, avatarId: string): Promise<Result<{ brief: AvatarBrief }>> {
  const { data: avatar } = await ctx.supabase.from("avatars").select("id, account_id").eq("id", avatarId).maybeSingle();
  if (!avatar) return { error: "Avatar introuvable" };
  try {
    const brief = await compileAvatarBrief(createAdminClient(), avatarId, ctx.session.profile.id);
    broadcastAccountEvent(avatar.account_id, "jobs", { action: "brief_compiled", id: avatarId });
    return { brief };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Compilation impossible" };
  }
}
