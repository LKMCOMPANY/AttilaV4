/**
 * Types for raw data returned by the Gorgone Supabase client.
 * These represent the shape of Gorgone's tables, not Attila's.
 */

export interface GorgoneClient {
  id: string;
  name: string;
  is_active: boolean;
}

export interface GorgoneZone {
  id: string;
  name: string;
  client_id: string;
  is_active: boolean;
  push_to_attila: boolean;
  data_sources: {
    twitter?: boolean;
    tiktok?: boolean;
    media?: boolean;
  };
}

export interface GorgoneRawTweetRow {
  id: string;
  zone_id: string;
  tweet_id: string;
  conversation_id: string | null;
  text: string;
  lang: string | null;
  twitter_created_at: string;
  collected_at: string;
  retweet_count: number;
  reply_count: number;
  like_count: number;
  quote_count: number;
  view_count: number;
  total_engagement: number;
  is_reply: boolean;
  in_reply_to_tweet_id: string | null;
  tweet_url: string | null;
  author: {
    username: string | null;
    name: string | null;
    followers_count: number;
    is_verified: boolean;
    is_blue_verified: boolean;
    profile_picture_url: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Capacity Estimator
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Raw Gorgone rows (sync)
// ---------------------------------------------------------------------------

export interface GorgoneRawTiktokVideoRow {
  id: string;
  zone_id: string;
  video_id: string;
  description: string | null;
  language: string | null;
  tiktok_created_at: string;
  collected_at: string;
  play_count: number;
  digg_count: number;
  comment_count: number;
  share_count: number;
  collect_count: number;
  total_engagement: number;
  share_url: string | null;
  is_ad: boolean;
  author: {
    username: string | null;
    nickname: string | null;
    follower_count: number;
    is_verified: boolean;
    is_private: boolean;
    avatar_thumb: string | null;
  } | null;
}
