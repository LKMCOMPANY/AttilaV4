import type { createGorgoneClient } from "./client";
import type { GorgoneNetwork } from "@/types";

/**
 * Capacity estimator — Supabase queries against Gorgone V4's `public.posts`
 * partitioned table + `social_users` + per-network extras.
 *
 * Pure I/O layer. Numeric reductions and percentage math live in
 * `capacity-math.ts`. The orchestrator in `capacity-estimator.ts` glues
 * the two together.
 */

type GorgoneSupabase = ReturnType<typeof createGorgoneClient>;
const SAMPLE_LIMIT = 5000;

// ---------------------------------------------------------------------------
// Shared low-level queries
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
  const { count } = await q;
  return count ?? 0;
}

export async function countTiktokAds(
  gorgone: GorgoneSupabase,
  zoneId: string,
  since: string,
): Promise<number> {
  const { count } = await gorgone
    .from("tiktok_post_extras")
    .select("post_id, posts!inner()", { count: "exact", head: true })
    .eq("zone_id", zoneId)
    .eq("is_ads", true)
    .eq("posts.network", "tiktok")
    .gte("posts.first_seen_at", since);
  return count ?? 0;
}

export async function countTiktokPrivateAuthors(
  gorgone: GorgoneSupabase,
  zoneId: string,
  since: string,
): Promise<number> {
  const { data } = await gorgone
    .from("posts")
    .select("author_social_user_id, author:social_users!author_social_user_id(protected)")
    .eq("zone_id", zoneId)
    .eq("network", "tiktok")
    .is("deleted_at", null)
    .gte("first_seen_at", since)
    .limit(SAMPLE_LIMIT);

  if (!data) return 0;
  type Row = {
    author_social_user_id: string;
    author: { protected: boolean | null } | null;
  };
  return (data as unknown as Row[]).filter((r) => r.author?.protected).length;
}

export async function languageHistogram(
  gorgone: GorgoneSupabase,
  zoneId: string,
  network: GorgoneNetwork,
  since: string,
): Promise<Record<string, number>> {
  const { data } = await gorgone
    .from("posts")
    .select("lang")
    .eq("zone_id", zoneId)
    .eq("network", network)
    .is("deleted_at", null)
    .gte("first_seen_at", since);

  if (!data) return {};
  const counts: Record<string, number> = {};
  for (const row of data as { lang: string | null }[]) {
    const lang = row.lang ?? "unknown";
    counts[lang] = (counts[lang] ?? 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Network-specific author stats — return raw rows, math in capacity-math.ts
// ---------------------------------------------------------------------------

export interface RawTwitterAuthorRow {
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  quotes: number | null;
  views: number | null;
  author: {
    followers_count: number | null;
    twitter_social_user_extras: {
      blue_verified: boolean | null;
      legacy_verified: boolean | null;
    }[] | null;
  } | null;
}

export interface RawTiktokAuthorRow {
  views: number | null; // play_count
  likes: number | null; // digg_count
  replies: number | null; // comment_count
  retweets: number | null; // share_count
  author: {
    followers_count: number | null;
    tiktok_social_user_extras: { verified: boolean | null }[] | null;
  } | null;
}

export async function fetchTwitterAuthorRows(
  gorgone: GorgoneSupabase,
  zoneId: string,
  since: string,
): Promise<RawTwitterAuthorRow[]> {
  const { data } = await gorgone
    .from("posts")
    .select(
      `likes, retweets, replies, quotes, views,
       author:social_users!author_social_user_id (
         followers_count,
         twitter_social_user_extras (blue_verified, legacy_verified)
       )`,
    )
    .eq("zone_id", zoneId)
    .eq("network", "twitter")
    .is("deleted_at", null)
    .gte("first_seen_at", since)
    .limit(SAMPLE_LIMIT);
  return (data as unknown as RawTwitterAuthorRow[] | null) ?? [];
}

export async function fetchTiktokAuthorRows(
  gorgone: GorgoneSupabase,
  zoneId: string,
  since: string,
): Promise<RawTiktokAuthorRow[]> {
  const { data } = await gorgone
    .from("posts")
    .select(
      `views, likes, replies, retweets,
       author:social_users!author_social_user_id (
         followers_count,
         tiktok_social_user_extras (verified)
       )`,
    )
    .eq("zone_id", zoneId)
    .eq("network", "tiktok")
    .is("deleted_at", null)
    .gte("first_seen_at", since)
    .limit(SAMPLE_LIMIT);
  return (data as unknown as RawTiktokAuthorRow[] | null) ?? [];
}

/**
 * Find the start of the 24h estimation window for a (zone, network).
 * Anchored on the most recent `first_seen_at` so paused zones still
 * return sane stats from their last collection window.
 */
export async function resolveWindowStart(
  gorgone: GorgoneSupabase,
  zoneId: string,
  network: GorgoneNetwork,
  periodHours: number,
): Promise<string> {
  const { data } = await gorgone
    .from("posts")
    .select("first_seen_at")
    .eq("zone_id", zoneId)
    .eq("network", network)
    .is("deleted_at", null)
    .order("first_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.first_seen_at) {
    return new Date(Date.now() - periodHours * 3_600_000).toISOString();
  }
  const latestMs = new Date(data.first_seen_at as string).getTime();
  return new Date(latestMs - periodHours * 3_600_000).toISOString();
}
