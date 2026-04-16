import type { CampaignPlatform, AnalystDecision, Avatar } from "@/types";

// ---------------------------------------------------------------------------
// Source post (unified shape from gorgone_tweets / gorgone_tiktok_videos)
// ---------------------------------------------------------------------------

export interface PipelinePost {
  id: string;
  zone_id: string;
  account_id: string;
  platform: CampaignPlatform;
  post_url: string | null;
  post_text: string;
  post_author: string | null;
  author_followers: number;
  author_verified: boolean;
  total_engagement: number;
  language: string | null;
  collected_at: string;

  is_reply?: boolean;
  is_ad?: boolean;
  author_is_private?: boolean;
  post_type?: "post" | "reply" | "retweet";

  raw_metrics: Record<string, unknown>;
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
  mode?: "app" | "chrome";
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
