import type { SupabaseClient } from "@supabase/supabase-js";
import { createGorgoneClient } from "./client";
import { enqueueGorgoneJob } from "./ingest";
import type { GorgoneNetwork } from "@/types";

/**
 * Sweep reconciler — safety net behind the `posts_after_insert_attila`
 * webhook trigger.
 *
 * Webhooks are the primary delivery channel; this loop runs every
 * `GORGONE_SWEEP_INTERVAL_MS` (default 60 s) and pulls posts Gorgone may
 * have failed to push (Attila down during deploy, transient 5xx, network
 * hiccup). We use a per (account, zone, network) cursor that advances on
 * `posts.first_seen_at` (Gorgone's "moment we observed it") to ensure
 * monotonic forward progress.
 *
 * The cursor lives in `gorgone_post_jobs` itself: we read `MAX(collected_at)
 * WHERE zone_id = ? AND network = ?` per cursor. No separate state table
 * needed (V3 had `gorgone_zone_state`; the ledger collapses both roles).
 *
 * Cost: at most one short query per active (zone, network) tuple per
 * sweep tick, regardless of volume. Empty zones don't pay anything.
 */

const SWEEP_BATCH_SIZE = 200;
// How far back to look on the very first sweep for a freshly-subscribed
// (zone, network). Not needed during steady state because the trigger
// fires synchronously — this is purely a graceful-onboarding window.
const FIRST_SWEEP_WINDOW_MIN = 5;

export interface SweepReport {
  cursors_processed: number;
  zones_with_data: number;
  total_enqueued: number;
  errors: string[];
  duration_ms: number;
}

interface ActiveCursor {
  account_id: string;
  zone_id: string;
  network: GorgoneNetwork;
  /** Most recent `collected_at` we've already enqueued for this cursor. */
  cursor_at: string | null;
}

export async function runSweepCycle(
  attila: SupabaseClient,
): Promise<SweepReport> {
  const start = Date.now();
  const report: SweepReport = {
    cursors_processed: 0,
    zones_with_data: 0,
    total_enqueued: 0,
    errors: [],
    duration_ms: 0,
  };

  const cursors = await loadActiveCursors(attila);
  report.cursors_processed = cursors.length;

  for (const cursor of cursors) {
    try {
      const enqueued = await sweepCursor(attila, cursor);
      if (enqueued > 0) {
        report.zones_with_data += 1;
        report.total_enqueued += enqueued;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report.errors.push(`${cursor.zone_id}/${cursor.network}: ${msg}`);
    }
  }

  report.duration_ms = Date.now() - start;
  return report;
}

/**
 * Resolves the (account, zone, network) tuples that need to be swept by
 * cross-referencing:
 *   - active `gorgone_links` (Attila side)
 *   - active `attila_zone_subscriptions` (Gorgone side, via the directory view)
 *
 * Then materialises one cursor per (zone, network) pair the subscription
 * declares, with the latest `collected_at` we've already enqueued.
 */
async function loadActiveCursors(
  attila: SupabaseClient,
): Promise<ActiveCursor[]> {
  // 1) Fetch active links Attila ↔ Gorgone account
  const { data: links, error: linkErr } = await attila
    .from("gorgone_links")
    .select("account_id, gorgone_account_id")
    .eq("is_active", true);

  if (linkErr) throw new Error(`load links: ${linkErr.message}`);

  type LinkRow = { account_id: string; gorgone_account_id: string };
  const linkRows = (links ?? []) as LinkRow[];
  if (linkRows.length === 0) return [];

  // Map Gorgone account_id → Attila account_id
  const accountByGorgone = new Map<string, string>();
  for (const row of linkRows) {
    if (row.gorgone_account_id) {
      accountByGorgone.set(row.gorgone_account_id, row.account_id);
    }
  }
  if (accountByGorgone.size === 0) return [];

  // 2) Fetch active subscriptions on Gorgone side (per-zone networks[])
  const gorgone = createGorgoneClient();
  const { data: subs, error: subErr } = await gorgone
    .from("attila_zone_subscriptions")
    .select("zone_id, account_id, networks, is_active")
    .eq("is_active", true)
    .in("account_id", [...accountByGorgone.keys()]);

  if (subErr) throw new Error(`load subscriptions: ${subErr.message}`);

  type SubRow = {
    zone_id: string;
    account_id: string;
    networks: GorgoneNetwork[];
    is_active: boolean;
  };
  const subRows = (subs ?? []) as SubRow[];

  // 3) Build cursor list with latest collected_at from the ledger
  const cursors: ActiveCursor[] = [];
  for (const sub of subRows) {
    const attilaAccount = accountByGorgone.get(sub.account_id);
    if (!attilaAccount) continue;
    for (const network of sub.networks) {
      const cursor_at = await readCursor(attila, sub.zone_id, network);
      cursors.push({
        account_id: attilaAccount,
        zone_id: sub.zone_id,
        network,
        cursor_at,
      });
    }
  }
  return cursors;
}

async function readCursor(
  attila: SupabaseClient,
  zoneId: string,
  network: GorgoneNetwork,
): Promise<string | null> {
  const { data } = await attila
    .from("gorgone_post_jobs")
    .select("collected_at")
    .eq("zone_id", zoneId)
    .eq("network", network)
    .order("collected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.collected_at as string | undefined) ?? null;
}

/**
 * Sweeps a single (zone, network) cursor — fetches recent posts from
 * Gorgone and enqueues them into Attila's ledger via `enqueueGorgoneJob`.
 */
async function sweepCursor(
  attila: SupabaseClient,
  cursor: ActiveCursor,
): Promise<number> {
  const gorgone = createGorgoneClient();
  const horizon =
    cursor.cursor_at ??
    new Date(Date.now() - FIRST_SWEEP_WINDOW_MIN * 60 * 1000).toISOString();

  const { data, error } = await gorgone
    .from("posts")
    .select("id, posted_at, account_id, zone_id, network, kind, first_seen_at, likes, retweets, replies, quotes")
    .eq("zone_id", cursor.zone_id)
    .eq("network", cursor.network)
    .gte("first_seen_at", horizon)
    .is("deleted_at", null)
    .order("first_seen_at", { ascending: true })
    .limit(SWEEP_BATCH_SIZE);

  if (error) throw new Error(`gorgone posts read: ${error.message}`);

  type Row = {
    id: string;
    posted_at: string;
    account_id: string;
    zone_id: string;
    network: GorgoneNetwork;
    kind: string | null;
    first_seen_at: string;
    likes: number | null;
    retweets: number | null;
    replies: number | null;
    quotes: number | null;
  };

  const rows = (data ?? []) as Row[];
  let count = 0;

  for (const row of rows) {
    const totalEngagement =
      (row.likes ?? 0) +
      (row.retweets ?? 0) +
      (row.replies ?? 0) +
      (row.quotes ?? 0);

    const result = await enqueueGorgoneJob(
      attila,
      {
        post_id: row.id,
        post_posted_at: row.posted_at,
        account_id: row.account_id,
        zone_id: row.zone_id,
        network: row.network,
        kind: (row.kind ?? "post") as "post" | "reply" | "repost" | "comment",
        collected_at: row.first_seen_at,
        total_engagement: totalEngagement,
      },
      "sweep",
    );
    if (result.inserted) count += 1;
  }

  return count;
}
