/**
 * Capacity Estimator types (used by `capacity-estimator.ts` and the UI).
 *
 * Directory types (`GorgoneClient`, `GorgoneZone`) live in `./zones.ts`.
 * Webhook payload types live in `./webhook-payload.ts`.
 * Ingestion is internal to `./ingest.ts` and `./sweep.ts`.
 */

/**
 * The estimation window. Anchored on the most recent `first_seen_at` for
 * the (zone, network) so paused zones still return stats from their last
 * collection window. `effective_hours` is the span actually covered by
 * data inside the window — a zone that collected for only 2h doesn't get
 * its hourly rate diluted by 24.
 */
export interface EstimationWindow {
  since: string;
  anchor: string;
  period_hours: number;
  effective_hours: number;
}

export interface TwitterBreakdown {
  platform: "twitter";
  original_posts: number;
  replies: number;
  retweets: number;
  pct_original: number;
  pct_replies: number;
  pct_retweets: number;
  /** Sample-based author/engagement stats. */
  pct_verified_authors: number;
  avg_engagement: number;
  avg_likes: number;
  avg_views: number;
}

export interface TiktokBreakdown {
  platform: "tiktok";
  videos: number;
  comments: number;
  pct_videos: number;
  pct_comments: number;
  /** Sample-based stats. Averages are computed over videos only. */
  pct_ads: number;
  pct_private_authors: number;
  pct_verified_authors: number;
  avg_play_count: number;
  avg_engagement: number;
}

export interface ZoneVolumeEstimate {
  zone_id: string;
  platform: "twitter" | "tiktok";
  window: EstimationWindow;
  /** Exact post count over the window (all kinds the pipeline ingests). */
  total_posts: number;
  /** total_posts / effective_hours. */
  avg_per_hour: number;
  /** Rows the filter simulation + sample stats ran on (most recent first). */
  sample_size: number;
  breakdown: TwitterBreakdown | TiktokBreakdown;
  /** Language histogram over the sample (raw counts, not %). */
  by_language: Record<string, number>;
}

export interface AppliedFilterRate {
  /** Stable identifier (CampaignFilters key). */
  key: string;
  /** Human-readable label, e.g. "Min 500 followers". */
  label: string;
  /** Pass rate of this filter alone, measured on the sample (0..1). */
  pass_rate: number;
}

export interface FilteredVolume {
  raw_per_hour: number;
  filtered_per_hour: number;
  /**
   * Joint pass rate of all filters combined, measured by running the
   * pipeline's own `applyFilters` on each sampled post. NOT the product
   * of individual rates — correlated filters are handled correctly.
   */
  filter_pass_rate: number;
  filters_applied: AppliedFilterRate[];
}

export interface AvatarCapacityInput {
  total_avatars: number;
  active_avatars: number;
  max_responses_per_avatar_per_hour: number;
  max_responses_per_avatar_per_day: number;
  min_avatars_per_post: number;
  max_avatars_per_post: number;
}

export interface CapacityEstimate {
  avg_avatars_per_post: number;
  responses_needed_per_hour: number;
  responses_needed_per_day: number;
  total_avatars: number;
  available_avatars: number;
  capacity_per_hour: number;
  capacity_per_day: number;
  avatars_needed: number;
  avatars_missing: number;
  bottleneck: "hourly" | "daily";
}

export interface CampaignCapacityResult {
  volume: ZoneVolumeEstimate;
  filtered: FilteredVolume;
  capacity: CapacityEstimate;
}
