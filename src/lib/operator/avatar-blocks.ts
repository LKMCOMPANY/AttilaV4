import type { RequestSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { broadcastAccountEvent } from "@/lib/supabase/realtime";
import { openBlock, closeBlock } from "@/lib/account-state/blocks";
import type { SocialPlatform } from "@/types";

/**
 * Guardrail block cores — the single implementation behind the Server
 * Actions (`src/app/actions/avatar-blocks.ts`) and the native REST routes
 * (`/api/avatars/[id]/blocks/…`).
 *
 * Reads stay on the caller's RLS-scoped client; writes go through the admin
 * client AFTER an explicit membership check — the same posture as the
 * pipeline (service role owns the table's writes), with `resolved_by`
 * recording who cleared the block. `avatar_platform_blocks` is the single
 * Automator gate: an active row = the avatar is skipped on that platform.
 */

/**
 * Operator "Mark resolved": clears the active block for (avatar, platform),
 * making the avatar selectable by the Automator again. Idempotent — resolving
 * an already-cleared block is a no-op, not an error. A derived (TikHub /
 * shadow-ban) block won't be reopened by the worker for a grace period, so the
 * operator's fix has time to take effect.
 */
export async function resolveAvatarBlockCore(
  ctx: RequestSession,
  avatarId: string,
  platform: SocialPlatform,
): Promise<{ error: string | null }> {
  const accountId = await getAvatarAccountId(ctx, avatarId);
  if (!accountId) return { error: "Avatar not found" };

  const admin = createAdminClient();
  await closeBlock(admin, { avatarId, platform, resolvedBy: ctx.session.profile.id });

  broadcastAccountEvent(accountId, "jobs", { action: "block_resolved" });
  return { error: null };
}

/**
 * Manual guardrail: an operator blocks the avatar on a platform by hand
 * (account under review, handover in progress…). Same effect as an automatic
 * block — the Automator skips the avatar until someone marks it resolved.
 */
export async function openAvatarBlockCore(
  ctx: RequestSession,
  avatarId: string,
  platform: SocialPlatform,
  note?: string,
): Promise<{ error: string | null }> {
  const accountId = await getAvatarAccountId(ctx, avatarId);
  if (!accountId) return { error: "Avatar not found" };

  const admin = createAdminClient();
  await openBlock(admin, {
    avatarId,
    platform,
    reason: "manual",
    source: "operator",
    detail: note?.trim() || "Blocked manually by an operator",
  });

  broadcastAccountEvent(accountId, "jobs", { action: "block_opened" });
  return { error: null };
}

/**
 * Membership guard shared by the write cores: resolves the avatar's account
 * and checks the caller belongs to it (admins pass). Uses the caller's client
 * so RLS provides defense in depth on top of the explicit check.
 */
async function getAvatarAccountId(
  ctx: RequestSession,
  avatarId: string,
): Promise<string | null> {
  const { data } = await ctx.supabase
    .from("avatars")
    .select("account_id")
    .eq("id", avatarId)
    .single();

  if (!data) return null;
  const accountId = data.account_id as string;
  if (ctx.session.profile.role !== "admin" && accountId !== ctx.session.profile.account_id) {
    return null;
  }
  return accountId;
}
