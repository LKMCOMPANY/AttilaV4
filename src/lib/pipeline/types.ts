import type { CampaignPlatform, AnalystDecision, Avatar } from "@/types";
import type { PostImage } from "./post-image";

// ---------------------------------------------------------------------------
// Source post — unified shape derived from a Gorgone V4 `posts` row
// ---------------------------------------------------------------------------
// Built by the pipeline after claiming a `gorgone_post_jobs` ledger row and
// re-fetching the full payload via `fetchFullGorgonePost`. The shape is
// network-agnostic with optional fields for network-specific filters.

/**
 * Minimal surface `applyFilters` needs to evaluate a post against
 * `CampaignFilters`. `PipelinePost` satisfies it structurally; the capacity
 * estimator builds it from sampled Gorgone rows so the *same* filter
 * implementation produces both runtime decisions and volume estimates.
 */
export interface FilterablePost {
  platform: CampaignPlatform;     // 'twitter' | 'tiktok'
  author_followers: number;
  author_verified: boolean;
  total_engagement: number;
  language: string | null;
  is_ad?: boolean;
  author_is_private?: boolean;
  post_type?: "post" | "reply" | "retweet";
  raw_metrics: Record<string, unknown>;
}

export interface PipelinePost extends FilterablePost {
  id: string;                     // gorgone posts.id
  posted_at: string;              // gorgone posts.posted_at (composite PK partner)
  zone_id: string;
  account_id: string;             // Attila account_id (resolved via gorgone_links)
  post_url: string | null;
  post_text: string;
  post_author: string | null;     // social_users.handle
  collected_at: string;           // posts.first_seen_at (when Gorgone observed it)

  // Signed CDN still (TikTok cover / photo, Twitter media) for the vision
  // analyst. Null when the post has no harvestable image; may 403 after the
  // CDN signature expires — consumers degrade to text-only.
  image_url?: string | null;

  is_reply?: boolean;

  // V4 bonuses (null when AI hasn't run yet — pipeline tolerates absence)
  sentiment_label?: "positive" | "negative" | "neutral" | string | null;
  sentiment_score?: number | null;
  translation_text?: string | null;
  translation_lang?: string | null;
}

// ---------------------------------------------------------------------------
// Pipeline result
// ---------------------------------------------------------------------------

export type PipelineAction =
  | "responded"
  | "filtered_rules"
  | "filtered_ai"
  | "no_avatars"
  | "skipped"
  | "error";

export interface PipelineResult {
  success: boolean;
  action: PipelineAction;
  postId: string | null;
  campaignId: string | null;
  jobsCreated: number;
  error?: string;
  phase?: string;
  timing: PipelineTiming;
}

export interface PipelineTiming {
  totalMs: number;
  filterMs?: number;
  analystMs?: number;
  selectorMs?: number;
  writerMs?: number;
  insertMs?: number;
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

export interface FilterResult {
  passed: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Analyst
// ---------------------------------------------------------------------------

export { AnalystDecision };

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

export interface WriterInput {
  post: PipelinePost;
  avatar: Avatar;
  platform: CampaignPlatform;
  guideline: {
    operational_context: string | null;
    strategy: string | null;
    key_messages: string | null;
  };
  previousCommentsOnPost: string[];
  recentAvatarComments: string[];
  /** Pre-fetched post still (one fetch per post, shared across avatars). */
  postImage?: PostImage | null;
}

export interface WriterResult {
  avatarId: string;
  commentText: string;
}

// ---------------------------------------------------------------------------
// Avatar selection
// ---------------------------------------------------------------------------

export interface SelectedAvatar {
  avatar: Avatar;
  device_id: string;
  box_id: string;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export interface ExecutionResult {
  success: boolean;
  sourceScreenshot?: Buffer;
  proofScreenshot?: Buffer;
  error?: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export type PipelinePhase =
  | "claim"
  | "match"
  | "filter"
  | "analyst"
  | "selector"
  | "writer"
  | "insert"
  | "execute"
  | "cleanup";

export function pipelineLog(
  phase: PipelinePhase,
  postId: string | null,
  message: string,
  data?: Record<string, unknown>,
) {
  const tag = postId ? `[Pipeline][${postId}][${phase}]` : `[Pipeline][${phase}]`;
  console.log(`${tag} ${message}`, data ? JSON.stringify(data) : "");
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

export function pipelineError(
  phase: PipelinePhase,
  postId: string | null,
  message: string,
  error?: unknown,
) {
  const tag = postId ? `[Pipeline][${postId}][${phase}]` : `[Pipeline][${phase}]`;
  if (error instanceof Error) {
    console.error(`${tag} ${message}`, error.message, error.stack);
  } else {
    console.error(`${tag} ${message}`, error);
  }
}
