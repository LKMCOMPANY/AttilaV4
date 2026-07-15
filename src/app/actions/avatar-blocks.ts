"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession, type Session } from "@/lib/auth/session";
import { broadcastAccountEvent } from "@/lib/supabase/realtime";
import { openBlock, closeBlock } from "@/lib/account-state/blocks";
import type { AvatarPlatformBlock, SocialPlatform } from "@/types";

// ---------------------------------------------------------------------------
// Guardrail blocks — operator-facing actions.
//
// Reads go through the user client (RLS scopes them to the caller's account).
// Writes go through the admin client AFTER an explicit membership check — the
// same posture as the pipeline (service role owns the table's writes), with
// `resolved_by` recording who cleared the block.
// ---------------------------------------------------------------------------

/**
 * Active blocks for every avatar of the account, keyed by avatar id.
 * Loaded by the operator layout on mount and re-fetched on realtime `jobs`
 * events, so the list dot and the Overview panel stay current without
 * re-calling the avatar.
 */
export async function getActiveBlocks(
  accountId: string,
): Promise<Record<string, AvatarPlatformBlock[]>> {
  const session = await requireSession();
  if (session.profile.role !== "admin" && accountId !== session.profile.account_id) {
    return {};
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("avatar_platform_blocks")
    .select(
      "id, avatar_id, platform, reason, source, detail, first_detected_at, avatar:avatars!inner(account_id)",
    )
    .eq("avatar.account_id", accountId)
    .is("resolved_at", null)
    .order("first_detected_at", { ascending: false });

  const byAvatar: Record<string, AvatarPlatformBlock[]> = {};
  for (const row of data ?? []) {
    const block: AvatarPlatformBlock = {
      id: row.id,
      platform: row.platform,
      reason: row.reason,
      source: row.source,
      detail: row.detail,
      first_detected_at: row.first_detected_at,
    };
    (byAvatar[row.avatar_id as string] ??= []).push(block);
  }
  return byAvatar;
}

/**
 * Operator "Mark resolved": clears the active block for (avatar, platform),
 * making the avatar selectable by the Automator again. Idempotent — resolving
 * an already-cleared block is a no-op, not an error. A derived (TikHub /
 * shadow-ban) block won't be reopened by the worker for a grace period, so the
 * operator's fix has time to take effect.
 */
export async function resolveAvatarPlatformBlock(
  avatarId: string,
  platform: SocialPlatform,
): Promise<{ error: string | null }> {
  const session = await requireSession();

  const accountId = await getAvatarAccountId(session, avatarId);
  if (!accountId) return { error: "Avatar not found" };

  const admin = createAdminClient();
  await closeBlock(admin, { avatarId, platform, resolvedBy: session.profile.id });

  broadcastAccountEvent(accountId, "jobs", { action: "block_resolved" });
  return { error: null };
}

/**
 * Manual guardrail: an operator blocks the avatar on a platform by hand
 * (account under review, handover in progress…). Same effect as an automatic
 * block — the Automator skips the avatar until someone marks it resolved.
 */
export async function blockAvatarPlatform(
  avatarId: string,
  platform: SocialPlatform,
  note?: string,
): Promise<{ error: string | null }> {
  const session = await requireSession();

  const accountId = await getAvatarAccountId(session, avatarId);
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
 * Membership guard shared by the write actions: resolves the avatar's account
 * and checks the caller belongs to it (admins pass). Uses the user client so
 * RLS provides defense in depth on top of the explicit check.
 */
async function getAvatarAccountId(
  session: Session,
  avatarId: string,
): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("avatars")
    .select("account_id")
    .eq("id", avatarId)
    .single();

  if (!data) return null;
  const accountId = data.account_id as string;
  if (session.profile.role !== "admin" && accountId !== session.profile.account_id) {
    return null;
  }
  return accountId;
}
