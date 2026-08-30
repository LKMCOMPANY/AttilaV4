import { z } from "zod";
import type { RequestSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Archive / restore cores (reversible soft-delete) — the single
 * implementation behind the Server Actions (`src/app/actions/avatars.ts`)
 * and the native REST routes (`/api/avatars/[id]/archive|unarchive`).
 * Archiving detaches the device (frees it), cancels queued jobs, and hides
 * the avatar from the active list. Executing jobs are left to finish.
 */

type ManageGate =
  | { ok: false; error: string }
  | { ok: true; accountId: string };

/** Manager+ gate shared by both cores: role, UUID shape, account membership. */
async function requireAvatarManage(
  ctx: RequestSession,
  avatarId: string,
): Promise<ManageGate> {
  const role = ctx.session.profile.role;
  if (role !== "admin" && role !== "manager") {
    return { ok: false, error: "Only admins and managers can manage avatars" };
  }
  if (!z.string().uuid().safeParse(avatarId).success) {
    return { ok: false, error: "Invalid avatar ID" };
  }

  const { data: avatar } = await ctx.supabase
    .from("avatars")
    .select("account_id")
    .eq("id", avatarId)
    .single();
  if (!avatar) return { ok: false, error: "Avatar not found" };
  if (role !== "admin" && ctx.session.profile.account_id !== avatar.account_id) {
    return { ok: false, error: "Forbidden" };
  }

  return { ok: true, accountId: avatar.account_id as string };
}

export async function archiveAvatarCore(
  ctx: RequestSession,
  avatarId: string,
): Promise<{ error: string | null }> {
  const gate = await requireAvatarManage(ctx, avatarId);
  if (!gate.ok) return { error: gate.error };

  // Cancel this avatar's queued jobs (ready); executing jobs finish on their own.
  // campaign_jobs is service-role only, and the caller is already authorized.
  await createAdminClient()
    .from("campaign_jobs")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("avatar_id", avatarId)
    .eq("status", "ready");

  const { error, count } = await ctx.supabase
    .from("avatars")
    .update({ device_id: null, archived_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", avatarId);
  if (error) return { error: error.message };
  if (count === 0) return { error: "Could not archive the avatar" };

  return { error: null };
}

export async function unarchiveAvatarCore(
  ctx: RequestSession,
  avatarId: string,
): Promise<{ error: string | null }> {
  const gate = await requireAvatarManage(ctx, avatarId);
  if (!gate.ok) return { error: gate.error };

  // Restore only; the device is NOT re-attached (it may be in use elsewhere).
  const { error, count } = await ctx.supabase
    .from("avatars")
    .update({ archived_at: null }, { count: "exact" })
    .eq("id", avatarId);
  if (error) return { error: error.message };
  if (count === 0) return { error: "Could not restore the avatar" };

  return { error: null };
}
