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
// Attila currently surfaces only Twitter + TikTok in the UI because the
// avatar-automation modules only exist for those two networks. The DB and
// the ingestion layer accept all five Gorgone V4 networks so adding a new
// surface (Reddit / Instagram / YouTube) is a UI-only change.

export const GORGONE_NETWORKS = [
  "twitter",
  "tiktok",
  "instagram",
  "youtube",
  "reddit",
] as const;
export type GorgoneNetwork = (typeof GORGONE_NETWORKS)[number];

/** Networks Attila exposes to operators today. Subset of GorgoneNetwork. */
export const SUPPORTED_GORGONE_NETWORKS = ["twitter", "tiktok"] as const;
export type SupportedGorgoneNetwork = (typeof SUPPORTED_GORGONE_NETWORKS)[number];

/** Alias kept for legacy call sites — equivalent to SupportedGorgoneNetwork. */
export type GorgonePlatform = SupportedGorgoneNetwork;

export type GorgoneJobStatus =
  | "pending"
  | "processing"
  | "processed"
  | "filtered_out"
  | "error"
  | "expired";

export type GorgoneDeliverySource = "webhook" | "sweep";
export type GorgonePostKind = "post" | "reply" | "repost" | "comment";

/** Attila ↔ Gorgone V4 account link. */
export interface GorgoneLink {
  id: string;
  account_id: string;
  /** Gorgone V4 account UUID (canonical name post-V4). */
  gorgone_account_id: string;
  /** Display name copied from Gorgone `accounts.name` at link time. */
  gorgone_client_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Legacy: matches gorgone_account_id during the transitional period —
  // dropped in the cleanup migration once nothing reads it.
  gorgone_client_id?: string;
}

/** Per-job ledger row (replaces V3 gorgone_tweets / gorgone_tiktok_videos). */
export interface GorgonePostJob {
  gorgone_post_id: string;
  gorgone_post_posted_at: string;
  account_id: string;
  zone_id: string;
  network: GorgoneNetwork;
  collected_at: string;
  total_engagement: number;
  kind: GorgonePostKind;
  status: GorgoneJobStatus;
  status_changed_at: string;
  campaign_id: string | null;
  error_message: string | null;
  delivery_source: GorgoneDeliverySource;
  attempts: number;
  created_at: string;
  updated_at: string;
}

/**
 * One row per (zone, network) the link's Gorgone subscription declares.
 * Used by the admin UI; combines Gorgone's per-zone subscription state
 * with the most recent ingestion stats from Attila's ledger.
 */
export interface GorgoneZoneRow {
  zone_id: string;
  zone_name: string;
  network: GorgoneNetwork;
  /** Live from Gorgone's `attila_zone_subscriptions.is_active`. */
  is_subscribed: boolean;
  /** True when the zone has at least one active rule on this network. */
  has_active_rule: boolean;
  /** Last ingestion timestamp from Attila's ledger (null = never). */
  last_event_at: string | null;
  /** Total enqueued for (zone, network). */
  total_received: number;
}

export interface GorgoneLinkWithZones extends GorgoneLink {
  zones: GorgoneZoneRow[];
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
  /** Which content kinds to respond to. Empty/undefined = both. */
  tiktok_content_kinds?: ("video" | "comment")[];
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
  /**
   * Timestamp of the last AI-driven write to (operational_context,
   * strategy, key_messages). Null when the guidelines have never
   * been AI-generated. Used by the UI for a stale indicator and by
   * the auto-update cron to skip campaigns whose guidelines have
   * been manually edited since the last AI write.
   */
  guidelines_generated_at: string | null;
  /**
   * Opt-in flag for the daily auto-regeneration cron. Default false
   * — the AI only writes on explicit operator click unless this is
   * flipped.
   */
  guidelines_auto_update: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Campaign Pipeline
// ---------------------------------------------------------------------------

export const CAMPAIGN_POST_STATUSES = ["pending", "processing", "responded", "awaiting_avatars", "filtered_out", "error"] as const;
export const CAMPAIGN_JOB_STATUSES = ["ready", "executing", "done", "failed", "cancelled", "expired"] as const;

export type CampaignPostStatus = (typeof CAMPAIGN_POST_STATUSES)[number];
export type CampaignJobStatus = (typeof CAMPAIGN_JOB_STATUSES)[number];

/** Top-sentiment label produced by Gorgone V4's AI enrichment pipeline. */
export type SentimentLabel = "positive" | "negative" | "neutral";

export interface CampaignPost {
  id: string;
  campaign_id: string;
  account_id: string;
  /**
   * Source table the post originated from. New rows always use
   * `gorgone_post_jobs`. Legacy values (`gorgone_tweets`,
   * `gorgone_tiktok_videos`) are kept readable for historical
   * campaign analytics until the V3 cleanup migration runs.
   */
  source_table: "gorgone_post_jobs" | "gorgone_tweets" | "gorgone_tiktok_videos";
  source_id: string;
  /** Network the source post was collected on. */
  source_network: GorgoneNetwork | null;
  platform: CampaignPlatform;
  post_url: string | null;
  post_text: string;
  post_author: string | null;
  post_metrics: Record<string, unknown>;
  ai_decision: AnalystDecision | null;
  status: CampaignPostStatus;
  processed_at: string | null;
  created_at: string;

  // ---------------------------------------------------------------------
  // Gorgone V4 enrichments — surfaced as first-class columns so the UI can
  // display them and future filters can use indexes instead of JSONB scans.
  // Each is null when Gorgone hadn't computed the signal yet at fetch time
  // (or when the post was processed before the V4 cutover).
  // ---------------------------------------------------------------------
  sentiment_label: SentimentLabel | null;
  sentiment_score: number | null;
  translation_text: string | null;
  translation_lang: string | null;
  /** When the post was originally published upstream (Gorgone's `posts.posted_at`). */
  source_posted_at: string | null;
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
  /** Execution attempts consumed (auto-retry of pre-compose failures). */
  attempts: number;
  created_at: string;
}

export interface CampaignJobWithAvatar extends CampaignJob {
  avatar_name: string | null;
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

