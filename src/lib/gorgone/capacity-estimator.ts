import { createGorgoneClient } from "./client";
import type { GorgoneNetwork } from "@/types";
import type {
  ZoneVolumeEstimate,
  TwitterBreakdown,
  TiktokBreakdown,
} from "./types";
import {
  countPosts,
  countTiktokAds,
  countTiktokPrivateAuthors,
  fetchTiktokAuthorRows,
  fetchTwitterAuthorRows,
  languageHistogram,
  resolveWindowStart,
} from "./capacity-queries";
import {
  applyFilters,
  estimateCapacity,
  reduceTiktokAuthors,
  reduceTwitterAuthors,
  round,
  safePct,
} from "./capacity-math";

/**
 * Capacity estimator — orchestrates Gorgone V4 reads + pure math to produce
 * the `(volume, filtered, capacity)` triple consumed by the campaign
 * creation wizard and the campaign dashboard.
 *
 * Layered responsibility:
 *   - `capacity-queries.ts` — raw Supabase reads against `public.posts`.
 *   - `capacity-math.ts`    — pure functions (filter pass rate, capacity).
 *   - this file             — composition + per-network breakdown shape.
 *
 * Window: anchored on the most recent `first_seen_at` for the (zone,
 * network), so paused zones still return sane stats from their last
 * collection window.
 */

const PERIOD_HOURS = 24;

export async function estimateZoneVolume(
  zoneId: string,
  network: GorgoneNetwork,
): Promise<ZoneVolumeEstimate> {
  if (network === "twitter") return estimateTwitterVolume(zoneId);
  if (network === "tiktok") return estimateTiktokVolume(zoneId);
  throw new Error(`Capacity estimator not implemented for network=${network}`);
}

async function estimateTwitterVolume(
  zoneId: string,
): Promise<ZoneVolumeEstimate> {
  const gorgone = createGorgoneClient();
  const since = await resolveWindowStart(gorgone, zoneId, "twitter", PERIOD_HOURS);

  const [total, replies, retweets, langRows, authorRows] = await Promise.all([
    countPosts(gorgone, zoneId, "twitter", since),
    countPosts(gorgone, zoneId, "twitter", since, { kind: "reply" }),
    countPosts(gorgone, zoneId, "twitter", since, { kind: "repost" }),
    languageHistogram(gorgone, zoneId, "twitter", since),
    fetchTwitterAuthorRows(gorgone, zoneId, since),
  ]);

  const authorStats = reduceTwitterAuthors(authorRows);
  const originalPosts = Math.max(0, total - replies - retweets);

  const breakdown: TwitterBreakdown = {
    platform: "twitter",
    original_posts: originalPosts,
    replies,
    retweets,
    pct_original: safePct(originalPosts, total),
    pct_replies: safePct(replies, total),
    pct_retweets: safePct(retweets, total),
    avg_engagement: authorStats.avg_engagement,
    avg_likes: authorStats.avg_likes,
    avg_views: authorStats.avg_views,
  };

  return {
    zone_id: zoneId,
    platform: "twitter",
    period_hours: PERIOD_HOURS,
    total_posts: total,
    avg_per_hour: round(total / PERIOD_HOURS),
    breakdown,
    by_language: langRows,
    author_stats: authorStats,
  };
}

async function estimateTiktokVolume(
  zoneId: string,
): Promise<ZoneVolumeEstimate> {
  const gorgone = createGorgoneClient();
  const since = await resolveWindowStart(gorgone, zoneId, "tiktok", PERIOD_HOURS);

  const [total, ads, privateAuthors, langRows, authorRows] = await Promise.all([
    countPosts(gorgone, zoneId, "tiktok", since),
    countTiktokAds(gorgone, zoneId, since),
    countTiktokPrivateAuthors(gorgone, zoneId, since),
    languageHistogram(gorgone, zoneId, "tiktok", since),
    fetchTiktokAuthorRows(gorgone, zoneId, since),
  ]);

  const authorStats = reduceTiktokAuthors(authorRows);

  const breakdown: TiktokBreakdown = {
    platform: "tiktok",
    total_videos: total,
    pct_ads: safePct(ads, total),
    pct_private_authors: safePct(privateAuthors, total),
    avg_play_count: authorStats.avg_plays,
    avg_engagement: authorStats.avg_engagement,
    avg_comments: authorStats.avg_comments,
    avg_digg: authorStats.avg_digg,
  };

  return {
    zone_id: zoneId,
    platform: "tiktok",
    period_hours: PERIOD_HOURS,
    total_posts: total,
    avg_per_hour: round(total / PERIOD_HOURS),
    breakdown,
    by_language: langRows,
    author_stats: authorStats,
  };
}

// Re-export the math primitives so consumers keep a single import surface.
export { applyFilters, estimateCapacity };
