"use server";

/**
 * Avatar Social — Server Actions
 *
 * Narrow, atomic mutations for the per-platform "enable" flag and the
 * credential JSONB on an avatar row.
 *
 * Why dedicated actions (vs. the generic `updateAvatar`):
 *   - Toggling a network must NEVER touch the credentials column.
 *   - Editing one credential field must NEVER overwrite the sibling fields.
 *
 * The credential mutation is delegated to the `set_avatar_credential`
 * Postgres function which uses `jsonb_set` server-side, so the rest of the
 * JSONB blob is preserved even if the client view is stale.
 */
 
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "@/types";
import {
  CREDENTIAL_FIELDS,
  type CredentialField,
} from "@/lib/constants/avatar";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const setEnabledSchema = z.object({
  avatarId: z.string().uuid(),
  platform: z.enum(SOCIAL_PLATFORMS),
  enabled: z.boolean(),
});

const setCredentialSchema = z.object({
  avatarId: z.string().uuid(),
  platform: z.enum(SOCIAL_PLATFORMS),
  field: z.enum(CREDENTIAL_FIELDS),
  // Empty string and null are both treated as "clear this field".
  value: z.string().nullable(),
});

type Supabase = Awaited<ReturnType<typeof createClient>>;

// ---------------------------------------------------------------------------
// Shared authorization
// ---------------------------------------------------------------------------

async function authorizeAvatarWrite(
  avatarId: string,
): Promise<{ supabase: Supabase | null; error: string | null }> {
  const session = await requireSession();
  const isAdmin = session.profile.role === "admin";
  const isManager = session.profile.role === "manager";

  if (!isAdmin && !isManager) {
    return { supabase: null, error: "Only admins and managers can edit avatars" };
  }

  const supabase = await createClient();
  const { data: avatar, error } = await supabase
    .from("avatars")
    .select("account_id")
    .eq("id", avatarId)
    .single();

  if (error || !avatar) return { supabase, error: "Avatar not found" };

  if (!isAdmin && session.profile.account_id !== avatar.account_id) {
    return { supabase, error: "Cannot edit avatars for another account" };
  }

  return { supabase, error: null };
}

// ---------------------------------------------------------------------------
// Toggle a platform's enabled flag
// ---------------------------------------------------------------------------

export async function setAvatarPlatformEnabled(
  avatarId: string,
  platform: SocialPlatform,
  enabled: boolean,
): Promise<{ error: string | null }> {
  const parsed = setEnabledSchema.safeParse({ avatarId, platform, enabled });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { supabase, error: authError } = await authorizeAvatarWrite(avatarId);
  if (authError || !supabase) return { error: authError ?? "Unauthorized" };

  const column = `${platform}_enabled`;
  const { error } = await supabase
    .from("avatars")
    .update({ [column]: enabled })
    .eq("id", avatarId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/operator");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Atomic credential field update
// ---------------------------------------------------------------------------

export async function setAvatarPlatformCredential(
  avatarId: string,
  platform: SocialPlatform,
  field: CredentialField,
  value: string | null,
): Promise<{ error: string | null }> {
  const parsed = setCredentialSchema.safeParse({
    avatarId,
    platform,
    field,
    value,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { supabase, error: authError } = await authorizeAvatarWrite(avatarId);
  if (authError || !supabase) return { error: authError ?? "Unauthorized" };

  const trimmed = parsed.data.value?.trim() ?? null;

  const { error } = await supabase.rpc("set_avatar_credential", {
    p_avatar_id: avatarId,
    p_column: `${platform}_credentials`,
    p_field: field,
    p_value: trimmed && trimmed.length > 0 ? trimmed : null,
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard/operator");
  return { error: null };
}
