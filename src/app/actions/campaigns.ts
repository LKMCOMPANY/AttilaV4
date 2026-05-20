"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/session";
import { fetchGorgoneZoneDirectory } from "@/lib/gorgone";
import { generateCampaignGuidelines as generateCampaignGuidelinesCore } from "@/lib/campaigns/guideline-generator";
import type { GuidelineGenerationResult } from "@/lib/campaigns/guideline-types";
import {
  SUPPORTED_GORGONE_NETWORKS,
  type Campaign,
  type CampaignFilters,
  type CampaignPlatform,
  type CapacityParams,
  type GorgoneLink,
  type SupportedGorgoneNetwork,
} from "@/types";

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

export interface AccountZone {
  zone_id: string;
  zone_name: string;
  /** Networks Attila supports today AND that have at least one signal:
   * either an active rule on Gorgone or an active subscription. */
  platforms: ("twitter" | "tiktok")[];
  gorgone_client_name: string;
  /**
   * True when the zone has an active Attila subscription declaring at
   * least one of the supported platforms. When false, the campaign
   * creation UI warns the operator that no posts will arrive even after
   * the campaign is launched.
   */
  push_enabled: boolean;
}

const SUPPORTED: ReadonlySet<SupportedGorgoneNetwork> = new Set(
  SUPPORTED_GORGONE_NETWORKS,
);

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
    .select("id, account_id, gorgone_account_id, gorgone_client_id, gorgone_client_name, is_active")
    .eq("account_id", accountId)
    .eq("is_active", true);

  if (error) throw new Error(error.message);

  const typedLinks = (links ?? []) as Pick<
    GorgoneLink,
    "id" | "account_id" | "gorgone_account_id" | "gorgone_client_id" | "gorgone_client_name" | "is_active"
  >[];

  const zoneMap = new Map<string, AccountZone>();

  for (const link of typedLinks) {
    const gorgoneAccountId = link.gorgone_account_id ?? link.gorgone_client_id ?? null;
    if (!gorgoneAccountId) continue;

    let directory: Awaited<ReturnType<typeof fetchGorgoneZoneDirectory>> = [];
    try {
      directory = await fetchGorgoneZoneDirectory(gorgoneAccountId);
    } catch (err) {
      // Gorgone unreachable: the screen shows nothing rather than stale
      // data. We log and continue so the page still renders.
      console.warn("[campaigns] zone directory fetch failed:", err);
      continue;
    }

    for (const dir of directory) {
      if (!dir.zone_is_active) continue;

      // Surface a zone if at least one supported platform has either an
      // active rule (Gorgone is collecting) OR an active subscription
      // (Attila is configured to receive).
      const supportedActive = [
        ...dir.active_rule_networks,
        ...dir.subscribed_networks,
      ].filter((n): n is SupportedGorgoneNetwork =>
        SUPPORTED.has(n as SupportedGorgoneNetwork),
      );
      if (supportedActive.length === 0) continue;

      const platforms = [...new Set(supportedActive)];
      const pushEnabled =
        dir.subscription_is_active === true &&
        dir.subscribed_networks.some((n) =>
          SUPPORTED.has(n as SupportedGorgoneNetwork),
        );

      zoneMap.set(dir.zone_id, {
        zone_id: dir.zone_id,
        zone_name: dir.zone_name,
        platforms,
        gorgone_client_name: link.gorgone_client_name,
        push_enabled: pushEnabled,
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

// ---------------------------------------------------------------------------
// AI guideline generation
// ---------------------------------------------------------------------------

/**
 * Public shape returned by `generateCampaignGuidelines` to the UI:
 *   - `suggestion`  the three strings ready to be applied
 *   - `metadata`    provenance for an audit trail (locale, postsSampled,
 *                   durationMs, prompt + doctrine version)
 *
 * Mirrors `GuidelineGenerationResult` from the lib but is re-exported
 * via the action surface so client components don't pull from `lib/...`
 * (RSC boundary discipline).
 */
export type GenerateGuidelinesResponse = GuidelineGenerationResult;

/**
 * Discriminated input — supports both the wizard (no campaignId yet,
 * the operator hasn't saved the draft) and the Automator detail panel
 * (campaign exists in DB).
 *
 *   `saved` mode: server reads the campaign row, runs the gen.
 *   `draft` mode: caller passes the not-yet-persisted fields inline.
 *
 * The two modes share a single resolver below — the only difference is
 * where the (account_id, name, platforms, gorgone_zone_id) tuple comes
 * from. Both go through the same auth + Gorgone-link resolution path
 * so there is zero security or behaviour drift.
 */
const generateGuidelinesSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("saved"),
    campaignId: z.string().uuid(),
  }),
  z.object({
    mode: z.literal("draft"),
    accountId: z.string().uuid(),
    name: z.string().min(1).max(200).trim(),
    platforms: z.array(z.enum(SUPPORTED_GORGONE_NETWORKS)).min(1),
    gorgoneZoneId: z.string().uuid(),
  }),
]);

export type GenerateGuidelinesInput = z.input<typeof generateGuidelinesSchema>;

interface ResolvedTarget {
  accountId: string;
  name: string;
  platforms: SupportedGorgoneNetwork[];
  gorgoneZoneId: string;
  /** UUID of the campaign row when `mode='saved'`, null otherwise. */
  campaignId: string | null;
}

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
  const session = await requireSession();
  const parsed = generateGuidelinesSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const target = await resolveGenerationTarget(supabase, parsed.data);
  if (!target.value) return { data: null, error: target.error };
  const t = target.value;

  // Authorisation — same shape as every other campaign action.
  if (
    session.profile.role !== "admin" &&
    t.accountId !== session.profile.account_id
  ) {
    return { data: null, error: "Forbidden" };
  }

  // Resolve the Gorgone V4 account uuid via the link table.
  const adminSupabase = createAdminClient();
  const { data: link } = await adminSupabase
    .from("gorgone_links")
    .select("gorgone_account_id")
    .eq("account_id", t.accountId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const gorgoneAccountId = link?.gorgone_account_id as string | undefined;
  if (!gorgoneAccountId) {
    return {
      data: null,
      error: "No active Gorgone link for this account",
    };
  }

  try {
    const result = await generateCampaignGuidelinesCore({
      campaign: {
        id: t.campaignId ?? "draft",
        name: t.name,
        platforms: t.platforms,
        gorgone_zone_id: t.gorgoneZoneId,
      },
      gorgoneAccountId,
    });
    return { data: result, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { data: null, error: message };
  }
}

async function resolveGenerationTarget(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: z.infer<typeof generateGuidelinesSchema>,
): Promise<{ value: ResolvedTarget; error: null } | { value: null; error: string }> {
  if (input.mode === "saved") {
    const { data: campaign, error } = await supabase
      .from("campaigns")
      .select("id, account_id, name, platforms, gorgone_zone_id")
      .eq("id", input.campaignId)
      .single();

    if (error || !campaign) {
      return { value: null, error: "Campaign not found" };
    }
    return {
      value: {
        accountId: campaign.account_id as string,
        name: campaign.name as string,
        platforms: campaign.platforms as SupportedGorgoneNetwork[],
        gorgoneZoneId: campaign.gorgone_zone_id as string,
        campaignId: campaign.id as string,
      },
      error: null,
    };
  }

  // draft mode — inline fields
  return {
    value: {
      accountId: input.accountId,
      name: input.name,
      platforms: input.platforms,
      gorgoneZoneId: input.gorgoneZoneId,
      campaignId: null,
    },
    error: null,
  };
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
  const session = await requireSession();
  const parsed = setAutoUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("campaigns")
    .select("account_id")
    .eq("id", parsed.data.campaignId)
    .single();

  if (!existing) return { error: "Campaign not found" };
  if (
    session.profile.role !== "admin" &&
    existing.account_id !== session.profile.account_id
  ) {
    return { error: "Forbidden" };
  }

  const { error } = await supabase
    .from("campaigns")
    .update({ guidelines_auto_update: parsed.data.enabled })
    .eq("id", parsed.data.campaignId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/automator");
  return { error: null };
}
