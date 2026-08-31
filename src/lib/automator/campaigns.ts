import type { RequestSession } from "@/lib/auth/session";
import { fetchGorgoneZoneDirectory, verifyZoneAccess } from "@/lib/gorgone";
import {
  SUPPORTED_GORGONE_NETWORKS,
  type Campaign,
  type CampaignFilters,
  type CampaignPlatform,
  type CapacityParams,
  type GorgoneLink,
  type SupportedGorgoneNetwork,
} from "@/types";

/**
 * Campaign CRUD cores — the single implementation behind the Server
 * Actions (`src/app/actions/campaigns.ts`, cookie transport) and the
 * native REST routes (`/api/campaigns/…`, bearer transport). Business
 * failures come back as `{ error }` payloads; only transport/auth
 * failures throw (mapped to 401/403 by `nativeRoute`).
 *
 * Every query runs on the caller's RLS-scoped client (`ctx.supabase`),
 * so both transports stay under identical row-level guarantees.
 */

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
    | "guidelines_generated_at"
    | "guidelines_auto_update"
  >
>;

export async function updateCampaignCore(
  ctx: RequestSession,
  campaignId: string,
  input: UpdateCampaignInput,
): Promise<{ data: Campaign | null; error: string | null }> {
  const { session, supabase } = ctx;

  const { data: existing, error: fetchErr } = await supabase
    .from("campaigns")
    .select("account_id, status, army_ids")
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

  // Guardrail: an active campaign with no army silently parks every
  // relevant post in `awaiting_avatars` (no job, no error). Block the
  // activation so the operator can't end up with a campaign that looks
  // live but can never respond. We evaluate the *resulting* state so the
  // check holds whether status, army_ids, or both are being patched.
  const nextStatus = input.status ?? (existing.status as Campaign["status"]);
  const nextArmyIds = input.army_ids ?? (existing.army_ids as string[]);
  if (nextStatus === "active" && nextArmyIds.length === 0) {
    return {
      data: null,
      error: "Assign at least one army before activating the campaign.",
    };
  }

  // Tenant guard — a re-pointed zone must belong to this account's
  // Gorgone links (zone_id is free client input).
  if (
    input.gorgone_zone_id !== undefined &&
    !(await verifyZoneAccess(supabase, existing.account_id, input.gorgone_zone_id))
  ) {
    return { data: null, error: "Zone not accessible for this account" };
  }

  const { data, error } = await supabase
    .from("campaigns")
    .update(input)
    .eq("id", campaignId)
    .select()
    .single();

  if (error) return { data: null, error: error.message };
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

export async function createCampaignCore(
  ctx: RequestSession,
  input: CreateCampaignInput,
): Promise<{ data: Campaign | null; error: string | null }> {
  const { session, supabase } = ctx;

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

  // Tenant guard — zone_id is free client input.
  if (!(await verifyZoneAccess(supabase, input.account_id, input.gorgone_zone_id))) {
    return { data: null, error: "Zone not accessible for this account" };
  }

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
  return { data: data as Campaign, error: null };
}

// ---------------------------------------------------------------------------
// Zones — available Gorgone zones for an account
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

export async function getAccountZonesCore(
  ctx: RequestSession,
  accountId: string,
): Promise<AccountZone[]> {
  const { session, supabase } = ctx;

  if (
    session.profile.role !== "admin" &&
    accountId !== session.profile.account_id
  ) {
    throw new Error("Forbidden");
  }

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
