export type UserRole = "admin" | "manager" | "operator";

export type AccountStatus = "active" | "standby" | "archived";

export type BoxStatus = "online" | "offline";

export type DeviceState = "running" | "stopped" | "creating" | "removed";

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  account_id: string | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  name: string;
  status: AccountStatus;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountWithUsers extends Account {
  profiles: UserProfile[];
  user_count: number;
}

// ---------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------

export interface Box {
  id: string;
  tunnel_hostname: string;
  name: string | null;
  lan_ip: string | null;
  status: BoxStatus;
  uptime_seconds: number | null;
  container_count: number;
  max_concurrent_containers: number;
  last_heartbeat: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface BoxWithRelations extends Box {
  accounts: Account[];
  device_count: number;
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export interface Device {
  id: string;
  box_id: string;
  account_id: string | null;
  db_id: string;
  user_name: string | null;

  image: string | null;
  aosp_version: string | null;
  resolution: string | null;
  memory_mb: number | null;
  dpi: number | null;
  fps: number | null;
  model: string | null;
  brand: string | null;
  serial: string | null;

  state: DeviceState;
  screen_state: string | null;
  foreground_app: string | null;
  country: string | null;
  locale: string | null;
  timezone: string | null;
  proxy_enabled: boolean;
  proxy_host: string | null;
  proxy_port: number | null;
  proxy_type: string | null;
  proxy_account: string | null;
  proxy_password: string | null;
  battery_level: number | null;
  docker_ip: string | null;
  tags: string[];
  last_seen: string | null;

  created_at: string;
  updated_at: string;
}

export interface DeviceWithBox extends Device {
  box: Box;
}

// ---------------------------------------------------------------------------
// Avatars — Personality enums (single source of truth)
// ---------------------------------------------------------------------------

export const WRITING_STYLES = ["casual", "formal", "journalistic", "provocative", "diplomatic"] as const;
export const TONES = ["neutral", "humorous", "serious", "sarcastic", "empathetic", "aggressive"] as const;
export const VOCABULARY_LEVELS = ["simple", "standard", "advanced", "technical"] as const;
export const EMOJI_USAGES = ["none", "sparse", "moderate", "frequent"] as const;
export const SOCIAL_PLATFORMS = ["twitter", "tiktok", "reddit", "instagram"] as const;
export const AVATAR_STATUSES = ["active", "inactive", "suspended"] as const;

export type WritingStyle = (typeof WRITING_STYLES)[number];
export type Tone = (typeof TONES)[number];
export type VocabularyLevel = (typeof VOCABULARY_LEVELS)[number];
export type EmojiUsage = (typeof EMOJI_USAGES)[number];
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export type AvatarStatus = (typeof AVATAR_STATUSES)[number];

export interface SocialCredentials {
  handle?: string;
  email?: string;
  password?: string;
  phone?: string;
  user_id?: string;
}

export interface Avatar {
  id: string;
  account_id: string;
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
  email: string | null;
  phone: string | null;
  country_code: string;
  language_code: string;
  device_id: string | null;
  writing_style: WritingStyle;
  tone: Tone;
  vocabulary_level: VocabularyLevel;
  emoji_usage: EmojiUsage;
  personality_traits: string[];
  topics_expertise: string[];
  topics_avoid: string[];
  twitter_enabled: boolean;
  tiktok_enabled: boolean;
  reddit_enabled: boolean;
  instagram_enabled: boolean;
  twitter_credentials: SocialCredentials;
  tiktok_credentials: SocialCredentials;
  reddit_credentials: SocialCredentials;
  instagram_credentials: SocialCredentials;
  status: AvatarStatus;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AvatarWithRelations extends Avatar {
  device?: Device | null;
  armies?: Army[];
  operators?: UserProfile[];
}

// ---------------------------------------------------------------------------
// Content Items
// ---------------------------------------------------------------------------

export const CONTENT_STATUSES = ["uploading", "ready", "pushed", "error"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export interface ContentItem {
  id: string;
  account_id: string;
  avatar_id: string | null;
  file_name: string;
  file_type: string;
  file_size: number;
  mime_type: string;
  storage_path: string;
  thumbnail_path: string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  status: ContentStatus;
  pushed_to_device_id: string | null;
  pushed_at: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Armies
// ---------------------------------------------------------------------------

export interface Army {
  id: string;
  account_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Gorgone Integration
// ---------------------------------------------------------------------------

export type GorgoneSyncStatus = "idle" | "syncing" | "error";
export type GorgoneSyncPlatform = "twitter" | "tiktok";

export interface GorgoneLink {
  id: string;
  account_id: string;
  gorgone_client_id: string;
  gorgone_client_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface GorgoneLinkWithCursors extends GorgoneLink {
  cursors: GorgoneSyncCursor[];
}

export interface GorgoneSyncCursor {
  id: string;
  gorgone_link_id: string;
  account_id: string;
  zone_id: string;
  zone_name: string;
  platform: GorgoneSyncPlatform;
  is_active: boolean;
  last_cursor: string | null;
  last_synced_at: string | null;
  total_synced: number;
  status: GorgoneSyncStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Campaigns (Automator)
// ---------------------------------------------------------------------------

export const CAMPAIGN_MODES = ["sniper"] as const;
export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "archived"] as const;
export const CAMPAIGN_PLATFORMS = ["twitter", "tiktok"] as const;

export type CampaignMode = (typeof CAMPAIGN_MODES)[number];
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export type CampaignPlatform = (typeof CAMPAIGN_PLATFORMS)[number];

export interface CampaignFilters {
  // Common (both platforms)
  min_author_followers?: number;
  verified_only?: boolean;
  languages?: string[];
  min_engagement?: number;

  // Twitter (X)
  post_types?: ("post" | "reply" | "retweet")[];
  min_like_count?: number;
  min_view_count?: number;
  min_reply_count?: number;
  min_quote_count?: number;
  min_retweet_count?: number;

  // TikTok
  exclude_ads?: boolean;
  exclude_private?: boolean;
  min_play_count?: number;
  min_comment_count?: number;
  min_digg_count?: number;
  min_share_count?: number;
  min_collect_count?: number;
}

export interface PlatformCapacityParams {
  max_responses_per_hour: number;
  max_responses_per_day: number;
  min_avatars_per_post: number;
  max_avatars_per_post: number;
  delay_min_seconds?: number;
  delay_max_seconds?: number;
  queue_max_age_minutes?: number;
}

export type CapacityParams = Record<CampaignPlatform, PlatformCapacityParams>;

export const DEFAULT_CAPACITY_PARAMS: CapacityParams = {
  twitter: { max_responses_per_hour: 5, max_responses_per_day: 50, min_avatars_per_post: 1, max_avatars_per_post: 3, delay_min_seconds: 30, delay_max_seconds: 120, queue_max_age_minutes: 120 },
  tiktok: { max_responses_per_hour: 3, max_responses_per_day: 30, min_avatars_per_post: 1, max_avatars_per_post: 2, delay_min_seconds: 60, delay_max_seconds: 180, queue_max_age_minutes: 180 },
};

export interface Campaign {
  id: string;
  account_id: string;
  name: string;
  mode: CampaignMode;
  status: CampaignStatus;
  platforms: CampaignPlatform[];
  gorgone_zone_id: string;
  gorgone_zone_name: string | null;
  army_ids: string[];
  filters: CampaignFilters;
  capacity_params: CapacityParams;
  operational_context: string | null;
  strategy: string | null;
  key_messages: string | null;
  total_posts_ingested: number;
  total_posts_filtered: number;
  total_responses_sent: number;
  total_responses_failed: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Campaign Pipeline
// ---------------------------------------------------------------------------

export const CAMPAIGN_POST_STATUSES = ["pending", "processing", "responded", "filtered_out", "error"] as const;
export const CAMPAIGN_JOB_STATUSES = ["ready", "executing", "done", "failed", "cancelled", "expired"] as const;

export type CampaignPostStatus = (typeof CAMPAIGN_POST_STATUSES)[number];
export type CampaignJobStatus = (typeof CAMPAIGN_JOB_STATUSES)[number];

export interface CampaignPost {
  id: string;
  campaign_id: string;
  account_id: string;
  source_table: "gorgone_tweets" | "gorgone_tiktok_videos";
  source_id: string;
  platform: CampaignPlatform;
  post_url: string | null;
  post_text: string;
  post_author: string | null;
  post_metrics: Record<string, unknown>;
  ai_decision: AnalystDecision | null;
  status: CampaignPostStatus;
  processed_at: string | null;
  created_at: string;
}

export interface CampaignJob {
  id: string;
  campaign_id: string;
  campaign_post_id: string;
  account_id: string;
  avatar_id: string;
  device_id: string;
  box_id: string;
  platform: CampaignPlatform;
  post_url: string;
  comment_text: string;
  status: CampaignJobStatus;
  error_message: string | null;
  source_screenshot: string | null;
  proof_screenshot: string | null;
  scheduled_at: string;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface CampaignJobWithRelations extends CampaignJob {
  avatar?: Avatar;
  campaign_post?: CampaignPost;
}

export interface AnalystDecision {
  relevant: boolean;
  reason: string;
  suggested_avatar_count: number;
}

