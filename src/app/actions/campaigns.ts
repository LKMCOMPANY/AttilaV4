"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { fetchGorgoneZones } from "@/lib/gorgone";
import type { Campaign, CampaignFilters, CampaignPlatform, CapacityParams, GorgoneSyncCursor } from "@/types";
import type { GorgoneZone } from "@/lib/gorgone/types";

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getCampaigns(accountId: string): Promise<Campaign[]> {
  const session = await requireSession();

  if (
    session.profile.role !== "admin" &&
    accountId !== session.profile.account_id
  ) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as Campaign[];
}

// ---------------------------------------------------------------------------
// Zones — fetch available Gorgone zones for an account
// ---------------------------------------------------------------------------

export interface AccountZone {
  zone_id: string;
  zone_name: string;
  platforms: ("twitter" | "tiktok")[];
  gorgone_client_name: string;
}

export async function getAccountZones(
  accountId: string
): Promise<AccountZone[]> {
  const session = await requireSession();

  if (
    session.profile.role !== "admin" &&
    accountId !== session.profile.account_id
  ) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();

  const { data: links, error } = await supabase
    .from("gorgone_links")
    .select("*, gorgone_sync_cursors(*)")
    .eq("account_id", accountId)
    .eq("is_active", true);

  if (error) throw new Error(error.message);

  interface LinkRow {
    id: string;
    account_id: string;
    gorgone_client_id: string;
    gorgone_client_name: string;
    is_active: boolean;
    gorgone_sync_cursors: GorgoneSyncCursor[];
  }

  const typedLinks = (links ?? []) as unknown as LinkRow[];
  const zoneMap = new Map<string, AccountZone>();

  for (const link of typedLinks) {
    const cursors = link.gorgone_sync_cursors ?? [];
    let zones: GorgoneZone[] = [];
    try {
      zones = await fetchGorgoneZones(link.gorgone_client_id);
    } catch {
      for (const cursor of cursors) {
        if (!cursor.is_active) continue;
        const existing = zoneMap.get(cursor.zone_id);
        if (existing) {
          if (!existing.platforms.includes(cursor.platform)) {
            existing.platforms.push(cursor.platform);
          }
        } else {
          zoneMap.set(cursor.zone_id, {
            zone_id: cursor.zone_id,
            zone_name: cursor.zone_name,
            platforms: [cursor.platform],
            gorgone_client_name: link.gorgone_client_name,
          });
        }
      }
      continue;
    }

    for (const zone of zones) {
      if (!zone.is_active) continue;
      const platforms: ("twitter" | "tiktok")[] = [];
      if (zone.data_sources?.twitter) platforms.push("twitter");
      if (zone.data_sources?.tiktok) platforms.push("tiktok");
      if (platforms.length === 0) continue;

      zoneMap.set(zone.id, {
        zone_id: zone.id,
        zone_name: zone.name,
        platforms,
        gorgone_client_name: link.gorgone_client_name,
      });
    }
  }

  return [...zoneMap.values()];
}

// ---------------------------------------------------------------------------
// Armies — fetch available armies for an account
// ---------------------------------------------------------------------------

export async function getAccountArmies(
  accountId: string
): Promise<{ id: string; name: string; avatar_count: number }[]> {
  const session = await requireSession();

  if (
    session.profile.role !== "admin" &&
    accountId !== session.profile.account_id
  ) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();

  const { data: armies, error } = await supabase
    .from("armies")
    .select("id, name, avatar_armies(count)")
    .eq("account_id", accountId)
    .order("name");

  if (error) throw new Error(error.message);

  return (armies ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    avatar_count:
      (a.avatar_armies as unknown as { count: number }[])?.[0]?.count ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export type UpdateCampaignInput = Partial<
  Pick<
    Campaign,
    | "name"
    | "mode"
    | "platforms"
    | "gorgone_zone_id"
    | "gorgone_zone_name"
    | "army_ids"
    | "filters"
    | "capacity_params"
    | "operational_context"
    | "strategy"
    | "key_messages"
    | "status"
  >
>;

export async function updateCampaign(
  campaignId: string,
  input: UpdateCampaignInput
): Promise<{ data: Campaign | null; error: string | null }> {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: existing, error: fetchErr } = await supabase
    .from("campaigns")
    .select("account_id")
    .eq("id", campaignId)
    .single();

  if (fetchErr || !existing) return { data: null, error: "Campaign not found" };

  if (
    session.profile.role !== "admin" &&
    existing.account_id !== session.profile.account_id
  ) {
    return { data: null, error: "Forbidden" };
  }

  if (input.name !== undefined && !input.name.trim()) {
    return { data: null, error: "Campaign name is required" };
  }

  if (input.platforms !== undefined && input.platforms.length === 0) {
    return { data: null, error: "At least one platform is required" };
  }

  const { data, error } = await supabase
    .from("campaigns")
    .update(input)
    .eq("id", campaignId)
    .select()
    .single();

  if (error) return { data: null, error: error.message };

  revalidatePath("/dashboard/automator");
  return { data: data as Campaign, error: null };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateCampaignInput {
  account_id: string;
  name: string;
  mode: "sniper";
  platforms: CampaignPlatform[];
  gorgone_zone_id: string;
  gorgone_zone_name: string | null;
  army_ids: string[];
  filters: CampaignFilters;
  capacity_params?: CapacityParams;
  operational_context: string | null;
  strategy: string | null;
  key_messages: string | null;
}

export async function createCampaign(
  input: CreateCampaignInput
): Promise<{ data: Campaign | null; error: string | null }> {
  const session = await requireSession();

  if (
    session.profile.role !== "admin" &&
    input.account_id !== session.profile.account_id
  ) {
    return { data: null, error: "Forbidden" };
  }

  if (!input.name.trim()) {
    return { data: null, error: "Campaign name is required" };
  }

  if (input.platforms.length === 0) {
    return { data: null, error: "At least one platform is required" };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      account_id: input.account_id,
      name: input.name.trim(),
      mode: input.mode,
      platforms: input.platforms,
      gorgone_zone_id: input.gorgone_zone_id,
      gorgone_zone_name: input.gorgone_zone_name,
      army_ids: input.army_ids,
      filters: input.filters,
      ...(input.capacity_params && { capacity_params: input.capacity_params }),
      operational_context: input.operational_context || null,
      strategy: input.strategy || null,
      key_messages: input.key_messages || null,
      created_by: session.profile.id,
    })
    .select()
    .single();

  if (error) return { data: null, error: error.message };

  revalidatePath("/dashboard/automator");
  return { data: data as Campaign, error: null };
}
