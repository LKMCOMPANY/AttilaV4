"use server";

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  WRITING_STYLES,
  TONES,
  VOCABULARY_LEVELS,
  EMOJI_USAGES,
  AVATAR_STATUSES,
} from "@/types";
import type { Avatar, AvatarWithRelations, Army, Device, UserProfile } from "@/types";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const socialCredentialsSchema = z.object({
  handle: z.string().optional(),
  email: z.string().optional(),
  password: z.string().optional(),
  phone: z.string().optional(),
  user_id: z.string().optional(),
}).default({});

const createAvatarSchema = z.object({
  account_id: z.string().uuid(),
  first_name: z.string().min(1, "First name is required").max(50),
  last_name: z.string().min(1, "Last name is required").max(50),
  profile_image_url: z.string().url().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  country_code: z.string().length(2),
  language_code: z.string().min(2).max(3),
  device_id: z.string().uuid().nullable().optional(),
  writing_style: z.enum(WRITING_STYLES).default("casual"),
  tone: z.enum(TONES).default("neutral"),
  vocabulary_level: z.enum(VOCABULARY_LEVELS).default("standard"),
  emoji_usage: z.enum(EMOJI_USAGES).default("sparse"),
  personality_traits: z.array(z.string()).default([]),
  topics_expertise: z.array(z.string()).default([]),
  topics_avoid: z.array(z.string()).default([]),
  twitter_enabled: z.boolean().default(false),
  tiktok_enabled: z.boolean().default(false),
  reddit_enabled: z.boolean().default(false),
  instagram_enabled: z.boolean().default(false),
  twitter_credentials: socialCredentialsSchema,
  tiktok_credentials: socialCredentialsSchema,
  reddit_credentials: socialCredentialsSchema,
  instagram_credentials: socialCredentialsSchema,
  operator_ids: z.array(z.string().uuid()).default([]),
  army_ids: z.array(z.string().uuid()).default([]),
  new_army_names: z.array(z.string().min(1).max(100)).default([]),
});

export type CreateAvatarInput = z.infer<typeof createAvatarSchema>;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getAccountDevices(
  accountId: string
): Promise<Device[]> {
  const session = await requireSession();
  const isAdmin = session.profile.role === "admin";
  if (!isAdmin && session.profile.account_id !== accountId) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();

  // Get box IDs assigned to this account
  const { data: boxLinks } = await supabase
    .from("account_boxes")
    .select("box_id")
    .eq("account_id", accountId);

  const boxIds = (boxLinks ?? []).map((b) => b.box_id);

  // Devices available = directly assigned OR inside an assigned box
  let query = supabase.from("devices").select("*");

  if (boxIds.length > 0) {
    query = query.or(
      `account_id.eq.${accountId},box_id.in.(${boxIds.join(",")})`
    );
  } else {
    query = query.eq("account_id", accountId);
  }

  const { data, error } = await query.order("user_name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Device[];
}

export async function getAccountUsers(
  accountId: string
): Promise<UserProfile[]> {
  const session = await requireSession();
  const isAdmin = session.profile.role === "admin";
  if (!isAdmin && session.profile.account_id !== accountId) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("account_id", accountId)
    .order("display_name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as UserProfile[];
}

export async function getAccountArmies(
  accountId: string
): Promise<Army[]> {
  const session = await requireSession();
  const isAdmin = session.profile.role === "admin";
  if (!isAdmin && session.profile.account_id !== accountId) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("armies")
    .select("*")
    .eq("account_id", accountId)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Army[];
}

export async function getAvatars(
  accountId: string
): Promise<AvatarWithRelations[]> {
  const session = await requireSession();
  const isAdmin = session.profile.role === "admin";
  if (!isAdmin && session.profile.account_id !== accountId) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("avatars")
    .select(
      `*,
      device:devices(*),
      avatar_armies(army:armies(*)),
      avatar_operators(operator:profiles(*))`
    )
    .eq("account_id", accountId)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row: Record<string, unknown>) => {
    const armies = (
      (row.avatar_armies as Record<string, unknown>[] | null) ?? []
    )
      .map((aa) => aa.army)
      .filter(Boolean) as Army[];

    const operators = (
      (row.avatar_operators as Record<string, unknown>[] | null) ?? []
    )
      .map((ao) => ao.operator)
      .filter(Boolean) as UserProfile[];

    const { avatar_armies: _aa, avatar_operators: _ao, ...rest } = row;
    return {
      ...rest,
      device: (row.device as Device | null) || null,
      armies,
      operators,
    } as AvatarWithRelations;
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createAvatar(
  input: CreateAvatarInput
): Promise<{ data: Avatar | null; error: string | null; warnings?: string[] }> {
  const session = await requireSession();
  const isAdmin = session.profile.role === "admin";
  const isManager = session.profile.role === "manager";

  if (!isAdmin && !isManager) {
    return { data: null, error: "Only admins and managers can create avatars" };
  }

  if (!isAdmin && session.profile.account_id !== input.account_id) {
    return { data: null, error: "Cannot create avatars for another account" };
  }

  const parsed = createAvatarSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const d = parsed.data;

  // 1. Create armies that don't exist yet
  const createdArmyIds: string[] = [];
  for (const name of d.new_army_names) {
    const { data: army, error: armyErr } = await supabase
      .from("armies")
      .upsert({ account_id: d.account_id, name }, { onConflict: "account_id,name" })
      .select("id")
      .single();

    if (armyErr) return { data: null, error: `Failed to create army "${name}": ${armyErr.message}` };
    createdArmyIds.push(army.id);
  }

  const allArmyIds = [...d.army_ids, ...createdArmyIds];

  // 2. Insert avatar
  const { data: avatar, error: avatarErr } = await supabase
    .from("avatars")
    .insert({
      account_id: d.account_id,
      first_name: d.first_name,
      last_name: d.last_name,
      profile_image_url: d.profile_image_url ?? null,
      email: d.email ?? null,
      phone: d.phone ?? null,
      country_code: d.country_code,
      language_code: d.language_code,
      device_id: d.device_id ?? null,
      writing_style: d.writing_style,
      tone: d.tone,
      vocabulary_level: d.vocabulary_level,
      emoji_usage: d.emoji_usage,
      personality_traits: d.personality_traits,
      topics_expertise: d.topics_expertise,
      topics_avoid: d.topics_avoid,
      twitter_enabled: d.twitter_enabled,
      tiktok_enabled: d.tiktok_enabled,
      reddit_enabled: d.reddit_enabled,
      instagram_enabled: d.instagram_enabled,
      twitter_credentials: d.twitter_credentials,
      tiktok_credentials: d.tiktok_credentials,
      reddit_credentials: d.reddit_credentials,
      instagram_credentials: d.instagram_credentials,
      created_by: session.profile.id,
    })
    .select()
    .single();

  if (avatarErr) return { data: null, error: avatarErr.message };

  const warnings: string[] = [];

  // 3. Link armies
  if (allArmyIds.length > 0) {
    const { error: linkErr } = await supabase
      .from("avatar_armies")
      .insert(allArmyIds.map((army_id) => ({ avatar_id: avatar.id, army_id })));

    if (linkErr) {
      warnings.push(`Army assignment failed: ${linkErr.message}`);
    }
  }

  // 4. Link operators
  if (d.operator_ids.length > 0) {
    const { error: opErr } = await supabase
      .from("avatar_operators")
      .insert(d.operator_ids.map((profile_id) => ({ avatar_id: avatar.id, profile_id })));

    if (opErr) {
      warnings.push(`Operator assignment failed: ${opErr.message}`);
    }
  }

  revalidatePath("/dashboard/operator");
  return {
    data: avatar as Avatar,
    error: null,
    ...(warnings.length > 0 && { warnings }),
  };
}

// ---------------------------------------------------------------------------
// Update avatar columns
// ---------------------------------------------------------------------------

const updateAvatarSchema = z.object({
  first_name: z.string().min(1).max(50).optional(),
  last_name: z.string().min(1).max(50).optional(),
  profile_image_url: z.string().url().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  country_code: z.string().length(2).optional(),
  language_code: z.string().min(2).max(3).optional(),
  writing_style: z.enum(WRITING_STYLES).optional(),
  tone: z.enum(TONES).optional(),
  vocabulary_level: z.enum(VOCABULARY_LEVELS).optional(),
  emoji_usage: z.enum(EMOJI_USAGES).optional(),
  personality_traits: z.array(z.string()).optional(),
  topics_expertise: z.array(z.string()).optional(),
  topics_avoid: z.array(z.string()).optional(),
  twitter_enabled: z.boolean().optional(),
  tiktok_enabled: z.boolean().optional(),
  reddit_enabled: z.boolean().optional(),
  instagram_enabled: z.boolean().optional(),
  twitter_credentials: socialCredentialsSchema.optional(),
  tiktok_credentials: socialCredentialsSchema.optional(),
  reddit_credentials: socialCredentialsSchema.optional(),
  instagram_credentials: socialCredentialsSchema.optional(),
  status: z.enum(AVATAR_STATUSES).optional(),
  tags: z.array(z.string()).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

export async function updateAvatar(
  avatarId: string,
  patch: Record<string, unknown>
): Promise<{ error: string | null }> {
  const session = await requireSession();
  const isAdmin = session.profile.role === "admin";
  const isManager = session.profile.role === "manager";

  if (!isAdmin && !isManager) {
    return { error: "Only admins and managers can edit avatars" };
  }

  const parsed = updateAvatarSchema.safeParse(patch);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("avatars")
    .select("account_id")
    .eq("id", avatarId)
    .single();

  if (!existing) return { error: "Avatar not found" };
  if (!isAdmin && session.profile.account_id !== existing.account_id) {
    return { error: "Cannot edit avatars for another account" };
  }

  const { error } = await supabase
    .from("avatars")
    .update(parsed.data)
    .eq("id", avatarId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/operator");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Replace avatar armies (junction table)
// ---------------------------------------------------------------------------

export async function setAvatarArmies(
  avatarId: string,
  armyIds: string[],
  newArmyNames: string[] = []
): Promise<{ error: string | null }> {
  const session = await requireSession();
  const isAdmin = session.profile.role === "admin";
  const isManager = session.profile.role === "manager";
  if (!isAdmin && !isManager) return { error: "Forbidden" };

  const supabase = await createClient();

  const { data: avatar } = await supabase
    .from("avatars")
    .select("account_id")
    .eq("id", avatarId)
    .single();

  if (!avatar) return { error: "Avatar not found" };
  if (!isAdmin && session.profile.account_id !== avatar.account_id) {
    return { error: "Forbidden" };
  }

  const createdIds: string[] = [];
  for (const name of newArmyNames) {
    const { data: army, error: err } = await supabase
      .from("armies")
      .upsert({ account_id: avatar.account_id, name }, { onConflict: "account_id,name" })
      .select("id")
      .single();
    if (err) return { error: `Failed to create army "${name}": ${err.message}` };
    createdIds.push(army.id);
  }

  const allIds = [...armyIds, ...createdIds];

  await supabase.from("avatar_armies").delete().eq("avatar_id", avatarId);

  if (allIds.length > 0) {
    const { error } = await supabase
      .from("avatar_armies")
      .insert(allIds.map((army_id) => ({ avatar_id: avatarId, army_id })));
    if (error) return { error: error.message };
  }

  revalidatePath("/dashboard/operator");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Replace avatar operators (junction table)
// ---------------------------------------------------------------------------

export async function setAvatarOperators(
  avatarId: string,
  profileIds: string[]
): Promise<{ error: string | null }> {
  const session = await requireSession();
  const isAdmin = session.profile.role === "admin";
  const isManager = session.profile.role === "manager";
  if (!isAdmin && !isManager) return { error: "Forbidden" };

  const supabase = await createClient();

  const { data: avatar } = await supabase
    .from("avatars")
    .select("account_id")
    .eq("id", avatarId)
    .single();

  if (!avatar) return { error: "Avatar not found" };
  if (!isAdmin && session.profile.account_id !== avatar.account_id) {
    return { error: "Forbidden" };
  }

  await supabase.from("avatar_operators").delete().eq("avatar_id", avatarId);

  if (profileIds.length > 0) {
    const { error } = await supabase
      .from("avatar_operators")
      .insert(profileIds.map((profile_id) => ({ avatar_id: avatarId, profile_id })));
    if (error) return { error: error.message };
  }

  revalidatePath("/dashboard/operator");
  return { error: null };
}
