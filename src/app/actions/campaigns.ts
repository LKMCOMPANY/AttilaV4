"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireSession, requireActionSession } from "@/lib/auth/session";
import {
  createCampaignCore,
  updateCampaignCore,
  getAccountZonesCore,
  type CreateCampaignInput,
  type UpdateCampaignInput,
  type AccountZone,
} from "@/lib/automator/campaigns";
import {
  generateGuidelinesCore,
  type GenerateGuidelinesInput,
  type GenerateGuidelinesResponse,
} from "@/lib/automator/guidelines";
import type { Campaign } from "@/types";

export type {
  CreateCampaignInput,
  UpdateCampaignInput,
  AccountZone,
} from "@/lib/automator/campaigns";
export type {
  GenerateGuidelinesInput,
  GenerateGuidelinesResponse,
} from "@/lib/automator/guidelines";

// ---------------------------------------------------------------------------
// Cookie-transport wrappers around the campaign cores
// (`src/lib/automator/campaigns.ts`, `src/lib/automator/guidelines.ts`) —
// the native REST routes call the same cores under a bearer token. Only the
// transport concerns (session from cookies, `revalidatePath`) live here.
// ---------------------------------------------------------------------------

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

export async function getCampaign(
  campaignId: string,
): Promise<Campaign | null> {
  const session = await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();

  if (error || !data) return null;

  if (
    session.profile.role !== "admin" &&
    data.account_id !== session.profile.account_id
  ) {
    return null;
  }

  return data as Campaign;
}

// ---------------------------------------------------------------------------
// Zones — fetch available Gorgone zones for an account
// ---------------------------------------------------------------------------

export async function getAccountZones(
  accountId: string
): Promise<AccountZone[]> {
  const ctx = await requireActionSession();
  return getAccountZonesCore(ctx, accountId);
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

export async function updateCampaign(
  campaignId: string,
  input: UpdateCampaignInput
): Promise<{ data: Campaign | null; error: string | null }> {
  const ctx = await requireActionSession();
  const result = await updateCampaignCore(ctx, campaignId, input);
  if (result.data) revalidatePath("/dashboard/automator");
  return result;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createCampaign(
  input: CreateCampaignInput
): Promise<{ data: Campaign | null; error: string | null }> {
  const ctx = await requireActionSession();
  const result = await createCampaignCore(ctx, input);
  if (result.data) revalidatePath("/dashboard/automator");
  return result;
}

// ---------------------------------------------------------------------------
// AI guideline generation
// ---------------------------------------------------------------------------

/**
 * Generates the three guideline blocks via Aleria, anchored on the
 * zone's recent activity. Server-only. Does NOT persist — the caller
 * is responsible for showing the suggestion in a preview modal and
 * either applying it via `updateCampaign` (saved mode) or patching
 * the in-memory form data (draft mode).
 */
export async function generateCampaignGuidelines(
  input: GenerateGuidelinesInput,
): Promise<{ data: GenerateGuidelinesResponse | null; error: string | null }> {
  const ctx = await requireActionSession();
  return generateGuidelinesCore(ctx, input);
}

const setAutoUpdateSchema = z.object({
  campaignId: z.string().uuid(),
  enabled: z.boolean(),
});

/**
 * Toggles the daily auto-regeneration cron's reach on a single
 * campaign. Cheap update, kept in its own action so the UI can wire a
 * Switch with no other dependency.
 */
export async function setCampaignGuidelinesAutoUpdate(
  input: z.infer<typeof setAutoUpdateSchema>,
): Promise<{ error: string | null }> {
  const parsed = setAutoUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const ctx = await requireActionSession();
  const { error } = await updateCampaignCore(ctx, parsed.data.campaignId, {
    guidelines_auto_update: parsed.data.enabled,
  });
  if (!error) revalidatePath("/dashboard/automator");
  return { error };
}
