"use server";

import { createClient } from "@/lib/supabase/server";
import { requireSession, requireActionSession } from "@/lib/auth/session";
import {
  resolveAvatarBlockCore,
  openAvatarBlockCore,
} from "@/lib/operator/avatar-blocks";
import type { AvatarPlatformBlock, SocialPlatform } from "@/types";

// ---------------------------------------------------------------------------
// Guardrail blocks — operator-facing actions.
//
// Reads go through the user client (RLS scopes them to the caller's account).
// Writes delegate to the cores in `src/lib/operator/avatar-blocks.ts` (also
// behind the native REST routes), which check membership explicitly before
// writing through the admin client — the same posture as the pipeline.
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
 * making the avatar selectable by the Automator again.
 */
export async function resolveAvatarPlatformBlock(
  avatarId: string,
  platform: SocialPlatform,
): Promise<{ error: string | null }> {
  try {
    const ctx = await requireActionSession();
    return await resolveAvatarBlockCore(ctx, avatarId, platform);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Manual guardrail: an operator blocks the avatar on a platform by hand
 * (account under review, handover in progress…).
 */
export async function blockAvatarPlatform(
  avatarId: string,
  platform: SocialPlatform,
  note?: string,
): Promise<{ error: string | null }> {
  try {
    const ctx = await requireActionSession();
    return await openAvatarBlockCore(ctx, avatarId, platform, note);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}
