import type { createGorgoneClient } from "./client";
import type { GorgoneNetwork } from "@/types";
import type { EstimationWindow } from "./types";

/**
 * Capacity estimator — Supabase reads against Gorgone V4's `public.posts`
 * partitioned table (+ author / extras joins on the sample).
 *
 * Pure I/O layer: every helper THROWS on query error. A capacity number
 * built on a failed query is worse than no number — the previous
 * implementation returned 0 on error and the UI displayed "0 posts/h"
 * for zones that were in fact active.
 *
 * Reductions and percentage math live in `capacity-math.ts`. The
 * orchestrator in `capacity-estimator.ts` glues the two together.
 */

type GorgoneSupabase = ReturnType<typeof createGorgoneClient>;

/** Cap on sampled rows. 5000 recent posts give stable filter rates. */
const SAMPLE_LIMIT = 5000;

// ---------------------------------------------------------------------------
// Window resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the estimation window for a (zone, network): the `periodHours`
 * preceding the most recent `first_seen_at`. `effective_hours` is the
 * span actually covered by data (oldest→newest row in the window),
 * clamped to [1, periodHours], so freshly-created or paused zones get an
 * hourly rate over their real collection time instead of a diluted /24.
 *
 * Returns null when the zone has no posts at all for this network.
 */
export async function resolveWindow(
  gorgone: GorgoneSupabase,
  zoneId: string,
  network: GorgoneNetwork,
  periodHours: number,
): Promise<EstimationWindow | null> {
  const anchor = await boundaryFirstSeen(gorgone, zoneId, network, null, "desc");
  if (!anchor) return null;

  const anchorMs = new Date(anchor).getTime();
  const since = new Date(anchorMs - periodHours * 3_600_000).toISOString();

  const oldest = await boundaryFirstSeen(gorgone, zoneId, network, since, "asc");
  const oldestMs = oldest ? new Date(oldest).getTime() : anchorMs;
  const spanHours = (anchorMs - oldestMs) / 3_600_000;
  const effectiveHours = Math.min(Math.max(spanHours, 1), periodHours);

  return {
    since,
    anchor,
    period_hours: periodHours,
    effective_hours: Math.round(effectiveHours * 10) / 10,
  };
}

async function boundaryFirstSeen(
  gorgone: GorgoneSupabase,
  zoneId: string,
  network: GorgoneNetwork,
  since: string | null,
  direction: "asc" | "desc",
): Promise<string | null> {
  let q = gorgone
    .from("posts")
    .select("first_seen_at")
    .eq("zone_id", zoneId)
    .eq("network", network)
    .is("deleted_at", null);
  if (since) q = q.gte("first_seen_at", since);

  const { data, error } = await q
    .order("first_seen_at", { ascending: direction === "asc" })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`resolveWindow(${network}): ${error.message}`);
  return (data?.first_seen_at as string | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Exact counts (head requests — no rows transferred)
// ---------------------------------------------------------------------------

export async function countPosts(
  gorgone: GorgoneSupabase,
  zoneId: string,
  network: GorgoneNetwork,
  since: string,
  extra?: { kind?: string },
): Promise<number> {
  let q = gorgone
    .from("posts")
    .select("*", { count: "exact", head: true })
    .eq("zone_id", zoneId)
    .eq("network", network)
    .is("deleted_at", null)
    .gte("first_seen_at", since);
  if (extra?.kind) q = q.eq("kind", extra.kind);

  const { count, error } = await q;
  if (error) throw new Error(`countPosts(${network}${extra?.kind ? `, ${extra.kind}` : ""}): ${error.message}`);
  if (count == null) throw new Error(`countPosts(${network}): count unavailable`);
  return count;
}

// ---------------------------------------------------------------------------
// Unified sample — one query feeds the filter simulation AND every
// sample-based stat (languages, verified %, ads %, private %, averages).
// ---------------------------------------------------------------------------

export interface SampleAuthor {
  followers_count: number | null;
  protected: boolean | null;
  twitter_social_user_extras?: {
    blue_verified: boolean | null;
    legacy_verified: boolean | null;
  }[] | null;
  tiktok_social_user_extras?: { verified: boolean | null }[] | null;
}

/** One sampled Gorgone posts row with everything the filters inspect. */
export interface SampleRow {
  kind: string | null;
  lang: string | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  quotes: number | null;
  views: number | null;
  bookmarks: number | null;
  author: SampleAuthor | null;
  tiktok_post_extras?: { is_ads: boolean | null }[] | null;
}

const TWITTER_SAMPLE_SELECT = `
  kind, lang, likes, retweets, replies, quotes, views, bookmarks,
  author:social_users!author_social_user_id (
    followers_count, protected,
    twitter_social_user_extras (blue_verified, legacy_verified)
  )
`.trim();

const TIKTOK_SAMPLE_SELECT = `
  kind, lang, likes, retweets, replies, quotes, views, bookmarks,
  author:social_users!author_social_user_id (
    followers_count, protected,
    tiktok_social_user_extras (verified)
  ),
  tiktok_post_extras (is_ads)
`.trim();

/**
 * Fetch up to `SAMPLE_LIMIT` most-recent rows in the window. Ordering by
 * `first_seen_at DESC` keeps the sample deterministic and biased towards
 * the zone's current behaviour.
 */
export async function fetchSampleRows(
  gorgone: GorgoneSupabase,
  zoneId: string,
  network: "twitter" | "tiktok",
  since: string,
): Promise<SampleRow[]> {
  const select = network === "twitter" ? TWITTER_SAMPLE_SELECT : TIKTOK_SAMPLE_SELECT;

  const { data, error } = await gorgone
    .from("posts")
    .select(select)
    .eq("zone_id", zoneId)
    .eq("network", network)
    .is("deleted_at", null)
    .gte("first_seen_at", since)
    .order("first_seen_at", { ascending: false })
    .limit(SAMPLE_LIMIT);

  if (error) throw new Error(`fetchSampleRows(${network}): ${error.message}`);
  return (data as unknown as SampleRow[] | null) ?? [];
}
