/**
 * Capacity Estimator types (used by `capacity-estimator.ts` and the UI).
 *
 * Directory types (`GorgoneClient`, `GorgoneZone`) live in `./zones.ts`.
 * Webhook payload types live in `./webhook-payload.ts`.
 * Ingestion is internal to `./ingest.ts` and `./sweep.ts`.
 */

export interface TwitterBreakdown {
  platform: "twitter";
  original_posts: number;
  replies: number;
  retweets: number;
  pct_original: number;
  pct_replies: number;
  pct_retweets: number;
  avg_engagement: number;
  avg_likes: number;
  avg_views: number;
}

export interface TiktokBreakdown {
  platform: "tiktok";
  total_videos: number;
  pct_ads: number;
  pct_private_authors: number;
  avg_play_count: number;
  avg_engagement: number;
  avg_comments: number;
  avg_digg: number;
}

export interface ZoneVolumeEstimate {
  zone_id: string;
  platform: "twitter" | "tiktok";
  period_hours: number;
  total_posts: number;
  avg_per_hour: number;
  breakdown: TwitterBreakdown | TiktokBreakdown;
  by_language: Record<string, number>;
  author_stats: {
    pct_verified: number;
    pct_min_100_followers: number;
    pct_min_1000_followers: number;
    pct_min_10000_followers: number;
  };
}

export interface EstimatorFilters {
  platforms: ("twitter" | "tiktok")[];
  post_types?: ("post" | "reply" | "retweet")[];
  exclude_ads?: boolean;
  exclude_private?: boolean;
  min_play_count?: number;
  min_comment_count?: number;
  min_author_followers?: number;
  verified_only?: boolean;
  languages?: string[];
  min_engagement?: number;
  min_like_count?: number;
  min_view_count?: number;
}

export interface FilteredVolume {
  raw_per_hour: number;
  filtered_per_hour: number;
  filter_pass_rate: number;
  filters_applied: { name: string; pass_rate: number }[];
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
  blocked_rate: number;
  capacity_per_hour: number;
  capacity_per_day: number;
  surplus_per_hour: number;
  surplus_per_day: number;
  coverage_rate: number;
  avatars_needed_hourly: number;
  avatars_needed_daily: number;
  avatars_needed: number;
  avatars_missing: number;
  bottleneck: "hourly" | "daily";
}

export interface CampaignCapacityResult {
  volume: ZoneVolumeEstimate;
  filtered: FilteredVolume;
  capacity: CapacityEstimate;
}
