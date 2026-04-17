"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  fetchGorgoneClients as fetchClients,
  fetchGorgoneZones as fetchZones,
  setZonePushToAttila as setZonePushToAttilaCore,
  getZonePushStates,
  syncWebhookConfigToGorgone,
  getAttilaWebhookConfig,
  runSweepCycle,
  type GorgoneClient,
  type AttilaWebhookConfig,
  type SweepReport,
} from "@/lib/gorgone";
import type {
  GorgoneLink,
  GorgoneLinkWithZones,
  GorgoneZoneRow,
  GorgoneZoneState,
} from "@/types";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const linkSchema = z.object({
  accountId: z.string().uuid(),
  gorgoneClientId: z.string().uuid(),
  gorgoneClientName: z.string().min(1),
});

const linkIdSchema = z.object({ linkId: z.string().uuid() });

const togglePushSchema = z.object({
  zoneId: z.string().uuid(),
  enabled: z.boolean(),
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Returns every Gorgone link for an account, enriched with:
 *   - the live `push_to_attila` flag for each (zone, platform) (read from
 *     Gorgone),
 *   - the Attila-side ingestion state (from `gorgone_zone_state`).
 *
 * Zones declared by Gorgone but never pre-registered in Attila are
 * surfaced too — they appear with `state: null` and the admin can
 * still toggle them on (it'll create the state row lazily).
 */
export async function getGorgoneLinks(
  accountId: string,
): Promise<GorgoneLinkWithZones[]> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: links, error } = await supabase
    .from("gorgone_links")
    .select("*, gorgone_zone_state(*)")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const enriched: GorgoneLinkWithZones[] = [];

  for (const link of (links ?? []) as (GorgoneLink & {
    gorgone_zone_state: GorgoneZoneState[];
  })[]) {
    const states = link.gorgone_zone_state ?? [];

    // Fetch the canonical list of zones from Gorgone (always up to date).
    const gorgoneZones = await fetchZones(link.gorgone_client_id).catch(() => []);

    // Combine: every (zone, platform) Gorgone declares + every state row we
    // have. We dedupe by `${zone_id}:${platform}`.
    const stateMap = new Map<string, GorgoneZoneState>();
    for (const s of states) stateMap.set(`${s.zone_id}:${s.platform}`, s);

    const zoneIds = gorgoneZones.map((z) => z.id);
    const pushStates = await getZonePushStates(zoneIds).catch(() => new Map());

    const rows: GorgoneZoneRow[] = [];

    for (const z of gorgoneZones) {
      if (z.data_sources?.twitter) {
        rows.push({
          zone_id: z.id,
          zone_name: z.name,
          platform: "twitter",
          push_to_attila: pushStates.get(z.id) ?? false,
          state: stateMap.get(`${z.id}:twitter`) ?? null,
        });
      }
      if (z.data_sources?.tiktok) {
        rows.push({
          zone_id: z.id,
          zone_name: z.name,
          platform: "tiktok",
          push_to_attila: pushStates.get(z.id) ?? false,
          state: stateMap.get(`${z.id}:tiktok`) ?? null,
        });
      }
    }

    // Surface orphan state rows too (zones removed from Gorgone but still
    // referenced in our state). This protects against silently losing
    // visibility on historical activity.
    for (const s of states) {
      const seen = rows.some((r) => r.zone_id === s.zone_id && r.platform === s.platform);
      if (!seen) {
        rows.push({
          zone_id: s.zone_id,
          zone_name: s.zone_name,
          platform: s.platform,
          push_to_attila: false,
          state: s,
        });
      }
    }

    enriched.push({
      id: link.id,
      account_id: link.account_id,
      gorgone_client_id: link.gorgone_client_id,
      gorgone_client_name: link.gorgone_client_name,
      is_active: link.is_active,
      created_at: link.created_at,
      updated_at: link.updated_at,
      zones: rows.sort((a, b) =>
        a.zone_name.localeCompare(b.zone_name) || a.platform.localeCompare(b.platform),
      ),
    });
  }

  return enriched;
}

export async function getGorgoneClients(): Promise<GorgoneClient[]> {
  await requireAdmin();
  return fetchClients();
}

// ---------------------------------------------------------------------------
// Mutations — links
// ---------------------------------------------------------------------------

export async function linkGorgoneClient(
  input: z.infer<typeof linkSchema>,
): Promise<{ data: GorgoneLink | null; error: string | null }> {
  await requireAdmin();

  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { data: null, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: link, error: linkError } = await supabase
    .from("gorgone_links")
    .insert({
      account_id: parsed.data.accountId,
      gorgone_client_id: parsed.data.gorgoneClientId,
      gorgone_client_name: parsed.data.gorgoneClientName,
    })
    .select()
    .single();

  if (linkError) {
    if (linkError.code === "23505") {
      return { data: null, error: "This Gorgone client is already linked to this account." };
    }
    return { data: null, error: linkError.message };
  }

  // Pre-create zone state rows so the UI can show toggles before any event
  // arrives. Soft-fail: state rows are also created lazily by the webhook /
  // sweep via `register_gorgone_event`.
  await preregisterZoneStates(link.id, parsed.data.accountId, parsed.data.gorgoneClientId).catch(
    (err) => console.warn("[gorgone] pre-register zone states failed:", err),
  );

  revalidatePath("/admin/accounts");
  return { data: link as GorgoneLink, error: null };
}

export async function unlinkGorgoneClient(
  input: z.infer<typeof linkIdSchema>,
): Promise<{ error: string | null }> {
  await requireAdmin();
  const parsed = linkIdSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.from("gorgone_links").delete().eq("id", parsed.data.linkId);
  if (error) return { error: error.message };

  revalidatePath("/admin/accounts");
  return { error: null };
}

/**
 * Reconciles Attila's `gorgone_zone_state` rows with Gorgone's current
 * zone catalogue. Adds missing (zone, platform) entries; never deletes.
 */
export async function refreshGorgoneZones(
  input: z.infer<typeof linkIdSchema>,
): Promise<{ added: number; error: string | null }> {
  await requireAdmin();
  const parsed = linkIdSchema.safeParse(input);
  if (!parsed.success) return { added: 0, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: link, error } = await supabase
    .from("gorgone_links")
    .select("id, account_id, gorgone_client_id")
    .eq("id", parsed.data.linkId)
    .single();
  if (error || !link) return { added: 0, error: "Link not found" };

  const added = await preregisterZoneStates(link.id, link.account_id, link.gorgone_client_id);

  revalidatePath("/admin/accounts");
  return { added, error: null };
}

// ---------------------------------------------------------------------------
// Mutations — push toggle (writes directly into Gorgone)
// ---------------------------------------------------------------------------

export async function setZonePushEnabled(
  input: z.infer<typeof togglePushSchema>,
): Promise<{ error: string | null }> {
  await requireAdmin();
  const parsed = togglePushSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await setZonePushToAttilaCore(parsed.data.zoneId, parsed.data.enabled);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update Gorgone" };
  }

  revalidatePath("/admin/accounts");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Mutations — webhook config + sweep
// ---------------------------------------------------------------------------

/**
 * Mirrors Attila's webhook URL + secret (from env) to Gorgone's
 * `integration_config`. Idempotent.
 *
 * Required env vars (Render):
 *   - NEXT_PUBLIC_APP_URL          base URL of this Attila deployment
 *   - GORGONE_WEBHOOK_SECRET       shared secret (>=32 chars)
 */
export async function pushWebhookConfigToGorgone(): Promise<{
  ok: boolean;
  url: string;
  error: string | null;
}> {
  await requireAdmin();

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.GORGONE_WEBHOOK_SECRET;

  if (!baseUrl) return { ok: false, url: "", error: "NEXT_PUBLIC_APP_URL not set" };
  if (!secret) return { ok: false, url: "", error: "GORGONE_WEBHOOK_SECRET not set" };

  const url = `${baseUrl.replace(/\/$/, "")}/api/gorgone/webhook`;

  try {
    await syncWebhookConfigToGorgone({ url, secret });
    return { ok: true, url, error: null };
  } catch (err) {
    return { ok: false, url, error: err instanceof Error ? err.message : "unknown" };
  }
}

export async function inspectWebhookConfig(): Promise<AttilaWebhookConfig> {
  await requireAdmin();
  return getAttilaWebhookConfig();
}

/**
 * Manually triggers a sweep cycle. Useful from the admin UI as a
 * "rescue" action, or when bringing a freshly-linked zone online.
 */
export async function runSweepNow(): Promise<SweepReport & { error: string | null }> {
  await requireAdmin();
  try {
    const report = await runSweepCycle(createAdminClient());
    return { ...report, error: null };
  } catch (err) {
    return {
      cursors_processed: 0,
      zones_with_data: 0,
      total_ingested: 0,
      errors: [],
      duration_ms: 0,
      error: err instanceof Error ? err.message : "sweep failed",
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function preregisterZoneStates(
  linkId: string,
  accountId: string,
  gorgoneClientId: string,
): Promise<number> {
  const supabase = await createClient();

  const zones = await fetchZones(gorgoneClientId);

  const { data: existing } = await supabase
    .from("gorgone_zone_state")
    .select("zone_id, platform")
    .eq("gorgone_link_id", linkId);

  const existingKeys = new Set(
    ((existing ?? []) as { zone_id: string; platform: string }[]).map(
      (e) => `${e.zone_id}:${e.platform}`,
    ),
  );

  const newRows = zones.flatMap((z) => {
    const platforms: ("twitter" | "tiktok")[] = [];
    if (z.data_sources?.twitter) platforms.push("twitter");
    if (z.data_sources?.tiktok) platforms.push("tiktok");
    return platforms
      .filter((p) => !existingKeys.has(`${z.id}:${p}`))
      .map((platform) => ({
        gorgone_link_id: linkId,
        account_id: accountId,
        zone_id: z.id,
        zone_name: z.name,
        platform,
      }));
  });

  if (newRows.length === 0) return 0;

  const { error } = await supabase.from("gorgone_zone_state").insert(newRows);
  if (error) throw new Error(`pre-register zone states: ${error.message}`);

  return newRows.length;
}
