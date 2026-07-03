import { createGorgoneClient } from "./client";
import type { CampaignFilters, GorgoneNetwork } from "@/types";
import type { ZoneVolumeEstimate, FilteredVolume } from "./types";
import {
  countPosts,
  fetchSampleRows,
  resolveWindow,
  type SampleRow,
} from "./capacity-queries";
import {
  buildLanguageHistogram,
  buildTiktokBreakdown,
  buildTwitterBreakdown,
  computeFilteredVolume,
  estimateCapacity,
  round,
  sampleRowToFilterable,
} from "./capacity-math";

/**
 * Capacity estimator — orchestrates Gorgone V4 reads + pure math to produce
 * the `(volume, filtered, capacity)` triple consumed by the campaign
 * creation wizard and the campaign settings panel.
 *
 * Layered responsibility:
 *   - `capacity-queries.ts` — raw Supabase reads (throw on error).
 *   - `capacity-math.ts`    — pure functions; filter rates measured by
 *                             running the pipeline's own `applyFilters`
 *                             on the sample.
 *   - this file             — composition per network.
 *
 * Window: the 24h preceding the most recent `first_seen_at` for the
 * (zone, network); hourly rates use the hours actually covered by data.
 */

const PERIOD_HOURS = 24;

export interface ZoneVolumeWithSample {
  volume: ZoneVolumeEstimate;
  sample: SampleRow[];
}

export async function estimateZoneVolume(
  zoneId: string,
  network: GorgoneNetwork,
): Promise<ZoneVolumeWithSample> {
  if (network !== "twitter" && network !== "tiktok") {
    throw new Error(`Capacity estimator not implemented for network=${network}`);
  }

  const gorgone = createGorgoneClient();
  const window = await resolveWindow(gorgone, zoneId, network, PERIOD_HOURS);

  // Zone has never collected anything on this network.
  if (!window) {
    return { volume: emptyVolume(zoneId, network), sample: [] };
  }

  if (network === "twitter") {
    const [total, replies, retweets, sample] = await Promise.all([
      countPosts(gorgone, zoneId, "twitter", window.since),
      countPosts(gorgone, zoneId, "twitter", window.since, { kind: "reply" }),
      countPosts(gorgone, zoneId, "twitter", window.since, { kind: "repost" }),
      fetchSampleRows(gorgone, zoneId, "twitter", window.since),
    ]);

    return {
      volume: {
        zone_id: zoneId,
        platform: "twitter",
        window,
        total_posts: total,
        avg_per_hour: round(total / window.effective_hours),
        sample_size: sample.length,
        breakdown: buildTwitterBreakdown({ total, replies, retweets }, sample),
        by_language: buildLanguageHistogram(sample),
      },
      sample,
    };
  }

  const [total, comments, sample] = await Promise.all([
    countPosts(gorgone, zoneId, "tiktok", window.since),
    countPosts(gorgone, zoneId, "tiktok", window.since, { kind: "comment" }),
    fetchSampleRows(gorgone, zoneId, "tiktok", window.since),
  ]);

  return {
    volume: {
      zone_id: zoneId,
      platform: "tiktok",
      window,
      total_posts: total,
      avg_per_hour: round(total / window.effective_hours),
      sample_size: sample.length,
      breakdown: buildTiktokBreakdown({ total, comments }, sample),
      by_language: buildLanguageHistogram(sample),
    },
    sample,
  };
}

/**
 * Filter simulation over the sampled rows — same `applyFilters` as the
 * runtime pipeline, so the UI's "Filtered / h" matches live behaviour.
 */
export function applyCampaignFilters(
  { volume, sample }: ZoneVolumeWithSample,
  filters: CampaignFilters,
): FilteredVolume {
  const platform = volume.platform;
  const filterable = sample.map((row) => sampleRowToFilterable(row, platform));
  return computeFilteredVolume(volume, filterable, filters);
}

function emptyVolume(
  zoneId: string,
  network: "twitter" | "tiktok",
): ZoneVolumeEstimate {
  const now = new Date().toISOString();
  return {
    zone_id: zoneId,
    platform: network,
    window: {
      since: now,
      anchor: now,
      period_hours: PERIOD_HOURS,
      effective_hours: PERIOD_HOURS,
    },
    total_posts: 0,
    avg_per_hour: 0,
    sample_size: 0,
    breakdown:
      network === "twitter"
        ? {
            platform: "twitter",
            original_posts: 0,
            replies: 0,
            retweets: 0,
            pct_original: 0,
            pct_replies: 0,
            pct_retweets: 0,
            pct_verified_authors: 0,
            avg_engagement: 0,
            avg_likes: 0,
            avg_views: 0,
          }
        : {
            platform: "tiktok",
            videos: 0,
            comments: 0,
            pct_videos: 0,
            pct_comments: 0,
            pct_ads: 0,
            pct_private_authors: 0,
            pct_verified_authors: 0,
            avg_play_count: 0,
            avg_engagement: 0,
          },
    by_language: {},
  };
}

// Re-export the capacity math so consumers keep a single import surface.
export { estimateCapacity };
