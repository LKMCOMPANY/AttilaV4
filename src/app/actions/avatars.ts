"use server";

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { fetchContainerList } from "@/lib/box-api";
import { accountDeviceScopeFilter } from "@/lib/devices/access";
import {
  createAvatarSchema,
  updateAvatarSchema,
  type CreateAvatarInput,
} from "./_avatar-schemas";
import type { Avatar, AvatarWithRelations, Army, Device, UserProfile } from "@/types";

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

  const filter = await accountDeviceScopeFilter(supabase, accountId);
  const { data, error } = await supabase
    .from("devices")
    .select("*")
    .or(filter)
    .order("user_name", { ascending: true });

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

  const avatars = (data ?? []).map((row: Record<string, unknown>) => {
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

  // Device states are reconciled against the boxes out-of-band by
  // `refreshDeviceStates` (called by the operator UI after first paint), so
  // this query never blocks the page render on a per-box `list_names` call
  // through the Cloudflare tunnel (~0.6-1.7s each). The page shows the
  // last-known DB state immediately and converges to box truth a moment later.
  return avatars;
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

// NOTE: per-platform `*_enabled` and `*_credentials` columns are intentionally
// excluded here. They have dedicated atomic actions in `avatar-social.ts` so
// field never overwrites its siblings (see `updateAvatarSchema` in
// `_avatar-schemas`; credential/network edits go through `avatar-social`).
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

// ---------------------------------------------------------------------------
// Automator status — active jobs per avatar (for Operator page)
// ---------------------------------------------------------------------------

export interface AvatarAutomatorInfo {
  executing: number;
  queued: number;
}

export async function getAvatarAutomatorStatuses(
  accountId: string,
): Promise<Record<string, AvatarAutomatorInfo>> {
  const session = await requireSession();

  if (
    session.profile.role !== "admin" &&
    accountId !== session.profile.account_id
  ) {
    return {};
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("campaign_jobs")
    .select("avatar_id, status")
    .eq("account_id", accountId)
    .in("status", ["ready", "executing"]);

  const map: Record<string, AvatarAutomatorInfo> = {};
  for (const row of data ?? []) {
    const entry = map[row.avatar_id] ?? { executing: 0, queued: 0 };
    if (row.status === "executing") entry.executing++;
    else entry.queued++;
    map[row.avatar_id] = entry;
  }

  return map;
}

// ---------------------------------------------------------------------------
// Device → Avatar assignment map (shared by avatar wizard + admin infra)
// ---------------------------------------------------------------------------

export interface DeviceAvatarAssignment {
  avatarId: string;
  avatarName: string;
}

export async function getDeviceAvatarMap(): Promise<
  Record<string, DeviceAvatarAssignment>
> {
  await requireSession();
  const supabase = await createClient();

  const { data } = await supabase
    .from("avatars")
    .select("id, first_name, last_name, device_id")
    .not("device_id", "is", null);

  const map: Record<string, DeviceAvatarAssignment> = {};
  for (const row of data ?? []) {
    if (row.device_id) {
      map[row.device_id] = {
        avatarId: row.id,
        avatarName: `${row.first_name} ${row.last_name}`.trim(),
      };
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Device states — lightweight query for live updates (Operator page)
// ---------------------------------------------------------------------------

export async function getDeviceStates(
  accountId: string,
): Promise<Record<string, string>> {
  const session = await requireSession();

  if (
    session.profile.role !== "admin" &&
    accountId !== session.profile.account_id
  ) {
    return {};
  }

  const supabase = await createClient();

  const filter = await accountDeviceScopeFilter(supabase, accountId);
  const { data } = await supabase.from("devices").select("id, state").or(filter);

  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    map[row.id] = row.state;
  }
  return map;
}

/**
 * Reconcile the account's device states against the live box state and return
 * the fresh `deviceId -> state` map. Unlike `getDeviceStates` (a pure DB read),
 * this calls each box's `list_names` through the tunnel, so it is intentionally
 * kept out of the page render path: the operator UI invokes it once after the
 * first paint to converge to box truth without blocking navigation. A box that
 * is unreachable simply leaves its devices on their last-known DB state.
 */
export async function refreshDeviceStates(
  accountId: string,
): Promise<Record<string, string>> {
  const session = await requireSession();
  const isAdmin = session.profile.role === "admin";
  if (!isAdmin && accountId !== session.profile.account_id) return {};

  const supabase = await createClient();

  const filter = await accountDeviceScopeFilter(supabase, accountId);
  const { data: devices } = await supabase
    .from("devices")
    .select("id, db_id, box_id, state, boxes(tunnel_hostname)")
    .or(filter);
  if (!devices || devices.length === 0) return {};

  // One live container list per box (not per device).
  const hostByBox = new Map<string, string>();
  for (const d of devices) {
    const box = d.boxes as unknown as { tunnel_hostname: string } | null;
    if (d.box_id && box?.tunnel_hostname) hostByBox.set(d.box_id, box.tunnel_hostname);
  }

  const liveStateByDbId = new Map<string, string>();
  await Promise.all(
    [...hostByBox.values()].map(async (host) => {
      try {
        const data = await fetchContainerList(host);
        for (const c of data.list) liveStateByDbId.set(c.db_id, c.state);
      } catch {
        // Box unreachable -- keep DB state for its devices.
      }
    }),
  );

  const now = new Date().toISOString();
  const result: Record<string, string> = {};
  const updates: PromiseLike<unknown>[] = [];

  for (const d of devices) {
    const live = liveStateByDbId.get(d.db_id as string);
    const state = live ?? (d.state as string);
    result[d.id as string] = state;
    if (live && live !== d.state) {
      updates.push(
        supabase
          .from("devices")
          .update({ state: live, last_seen: now })
          .eq("id", d.id),
      );
    }
  }

  if (updates.length > 0) await Promise.all(updates);
  return result;
}
