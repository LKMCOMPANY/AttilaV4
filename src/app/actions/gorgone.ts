"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  fetchGorgoneAccounts,
  fetchGorgoneZoneDirectory,
  upsertZoneSubscription,
  ensureZoneSubscriptions,
  deleteZoneSubscriptionsForAccount,
  syncWebhookConfigToGorgone,
  getAttilaWebhookConfig,
  runSweepCycle,
  type GorgoneAccount,
  type AttilaWebhookConfig,
  type SweepReport,
} from "@/lib/gorgone";
import {
  GORGONE_NETWORKS,
  SUPPORTED_GORGONE_NETWORKS,
  type GorgoneNetwork,
  type GorgoneLink,
  type GorgoneLinkWithZones,
  type GorgoneZoneRow,
} from "@/types";

// Default networks the auto-subscribe layer activates on every newly-
// linked or newly-discovered zone. Restricted to networks Attila has an
// avatar-automation module for.
const DEFAULT_AUTO_NETWORKS: GorgoneNetwork[] = [...SUPPORTED_GORGONE_NETWORKS];

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const linkSchema = z.object({
  accountId: z.string().uuid(),
  gorgoneAccountId: z.string().uuid(),
  gorgoneAccountName: z.string().min(1),
});

const linkIdSchema = z.object({ linkId: z.string().uuid() });

const subscriptionSchema = z.object({
  zoneId: z.string().uuid(),
  isActive: z.boolean(),
  networks: z.array(z.enum(GORGONE_NETWORKS)).default([]),
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Returns every Gorgone link for an account, enriched with the zone
 * directory (live from Gorgone) + ingestion stats from the local ledger.
 */
export async function getGorgoneLinks(
  accountId: string,
): Promise<GorgoneLinkWithZones[]> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: links, error } = await supabase
    .from("gorgone_links")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const enriched: GorgoneLinkWithZones[] = [];
  const adminSupabase = createAdminClient();

  for (const raw of (links ?? []) as GorgoneLink[]) {
    const link = raw;
    const gorgoneAccountId = link.gorgone_account_id ?? link.gorgone_client_id ?? null;

    let zoneRows: GorgoneZoneRow[] = [];
    if (gorgoneAccountId && link.is_active) {
      try {
        let directory = await fetchGorgoneZoneDirectory(gorgoneAccountId);

        // DWIM auto-fill: any active zone that doesn't yet have a sub row
        // gets one with default supported networks. Existing rows
        // (including admin-disabled ones) are left untouched.
        const orphanZoneIds = directory
          .filter((d) => d.zone_is_active && d.subscription_is_active === null)
          .map((d) => d.zone_id);
        if (orphanZoneIds.length > 0) {
          await ensureZoneSubscriptions({
            gorgoneAccountId,
            zoneIds: orphanZoneIds,
            defaultNetworks: DEFAULT_AUTO_NETWORKS,
          }).catch((err) =>
            console.warn("[gorgone] auto-subscribe orphan zones failed:", err),
          );
          // Reload so the freshly-created subs surface in the UI right away.
          directory = await fetchGorgoneZoneDirectory(gorgoneAccountId);
        }

        const stats = await readLedgerStats(
          adminSupabase,
          directory.map((d) => d.zone_id),
        );

        zoneRows = directory.flatMap((dir) => {
          // Combined view: every (zone, network) declared by the
          // subscription OR by an active rule (so the admin sees both
          // "subscribed but no rule" warnings AND "rule running but not
          // subscribed" warnings).
          const networks = new Set<GorgoneNetwork>([
            ...dir.subscribed_networks,
            ...dir.active_rule_networks,
          ]);
          if (networks.size === 0) return [];

          const rows: GorgoneZoneRow[] = [];
          for (const network of networks) {
            const stat = stats.get(`${dir.zone_id}:${network}`);
            rows.push({
              zone_id: dir.zone_id,
              zone_name: dir.zone_name,
              network,
              is_subscribed:
                dir.subscription_is_active === true &&
                dir.subscribed_networks.includes(network),
              has_active_rule: dir.active_rule_networks.includes(network),
              last_event_at: stat?.last_event_at ?? null,
              total_received: stat?.total_received ?? 0,
            });
          }
          return rows;
        });
      } catch (err) {
        console.warn("[gorgone] zone directory fetch failed:", err);
      }
    }

    enriched.push({
      ...link,
      zones: zoneRows.sort(
        (a, b) =>
          a.zone_name.localeCompare(b.zone_name) ||
          a.network.localeCompare(b.network),
      ),
    });
  }

  return enriched;
}

export async function getGorgoneAccountsAction(): Promise<GorgoneAccount[]> {
  await requireAdmin();
  return fetchGorgoneAccounts();
}

// ---------------------------------------------------------------------------
// Mutations — links
// ---------------------------------------------------------------------------

export async function linkGorgoneAccount(
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
      gorgone_account_id: parsed.data.gorgoneAccountId,
      gorgone_client_id: parsed.data.gorgoneAccountId, // legacy column kept until cleanup
      gorgone_client_name: parsed.data.gorgoneAccountName,
    })
    .select()
    .single();

  if (linkError) {
    if (linkError.code === "23505") {
      return { data: null, error: "This Gorgone account is already linked." };
    }
    return { data: null, error: linkError.message };
  }

  // DWIM: auto-subscribe every existing active zone of the linked account
  // with the default supported networks. The admin can then opt-out
  // individual (zone, network) pairs from the UI as a kill switch.
  // Soft-fail: a failure here never aborts the link itself — the next
  // `getGorgoneLinks` page load will retry the auto-fill.
  try {
    const directory = await fetchGorgoneZoneDirectory(parsed.data.gorgoneAccountId);
    const activeZoneIds = directory
      .filter((d) => d.zone_is_active)
      .map((d) => d.zone_id);
    if (activeZoneIds.length > 0) {
      await ensureZoneSubscriptions({
        gorgoneAccountId: parsed.data.gorgoneAccountId,
        zoneIds: activeZoneIds,
        defaultNetworks: DEFAULT_AUTO_NETWORKS,
      });
    }
  } catch (err) {
    console.warn("[gorgone] auto-subscribe at link failed:", err);
  }

  revalidatePath("/admin/accounts");
  return { data: link as GorgoneLink, error: null };
}

export async function unlinkGorgoneAccount(
  input: z.infer<typeof linkIdSchema>,
): Promise<{ error: string | null }> {
  await requireAdmin();
  const parsed = linkIdSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();

  // Look up which Gorgone account this link points at BEFORE deleting it,
  // so we can clean up the matching subscriptions on the Gorgone side.
  const { data: link, error: readErr } = await supabase
    .from("gorgone_links")
    .select("gorgone_account_id, gorgone_client_id")
    .eq("id", parsed.data.linkId)
    .maybeSingle();

  if (readErr) return { error: readErr.message };

  const { error } = await supabase
    .from("gorgone_links")
    .delete()
    .eq("id", parsed.data.linkId);
  if (error) return { error: error.message };

  // Soft-fail cleanup: a failure here never aborts the unlink. Orphan
  // subscriptions can be cleaned up manually later if needed.
  const gorgoneAccountId = link?.gorgone_account_id ?? link?.gorgone_client_id;
  if (gorgoneAccountId) {
    await deleteZoneSubscriptionsForAccount(gorgoneAccountId).catch((err) =>
      console.warn("[gorgone] subscription cleanup at unlink failed:", err),
    );
  }

  revalidatePath("/admin/accounts");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Mutations — zone subscriptions (writes to Gorgone V4)
// ---------------------------------------------------------------------------

export async function setZoneSubscription(
  input: z.infer<typeof subscriptionSchema>,
): Promise<{ error: string | null }> {
  await requireAdmin();
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Always upsert (never delete). The row is the persisted record of the
  // admin's intent — if we deleted on toggle-off, the next page refresh
  // would auto-recreate the sub via `ensureZoneSubscriptions`.
  try {
    await upsertZoneSubscription({
      zoneId: parsed.data.zoneId,
      isActive: parsed.data.isActive,
      networks: parsed.data.networks,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update subscription" };
  }

  revalidatePath("/admin/accounts");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Mutations — webhook config + sweep
// ---------------------------------------------------------------------------

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

export async function runSweepNow(): Promise<SweepReport & { error: string | null }> {
  await requireAdmin();
  try {
    const report = await runSweepCycle(createAdminClient());
    return { ...report, error: null };
  } catch (err) {
    return {
      cursors_processed: 0,
      zones_with_data: 0,
      total_enqueued: 0,
      errors: [],
      duration_ms: 0,
      error: err instanceof Error ? err.message : "sweep failed",
    };
  }
}

// ---------------------------------------------------------------------------
// Internal — ledger stats per (zone, network)
// ---------------------------------------------------------------------------

interface LedgerStat {
  last_event_at: string | null;
  total_received: number;
}

async function readLedgerStats(
  supabase: ReturnType<typeof createAdminClient>,
  zoneIds: string[],
): Promise<Map<string, LedgerStat>> {
  if (zoneIds.length === 0) return new Map();

  const { data } = await supabase
    .from("gorgone_post_jobs")
    .select("zone_id, network, collected_at")
    .in("zone_id", zoneIds)
    .order("collected_at", { ascending: false })
    .limit(10000);

  const map = new Map<string, LedgerStat>();
  if (!data) return map;

  type Row = { zone_id: string; network: string; collected_at: string };
  for (const row of data as Row[]) {
    const key = `${row.zone_id}:${row.network}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { last_event_at: row.collected_at, total_received: 1 });
    } else {
      // Already at the freshest collected_at thanks to the descending order.
      existing.total_received += 1;
    }
  }
  return map;
}
