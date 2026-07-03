"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { broadcastCampaignEvent, broadcastAccountEvent } from "@/lib/supabase/realtime";
import { requireSession, requireAdmin } from "@/lib/auth/session";
import { selectAvatars } from "@/lib/pipeline/avatar-selector";
import { generateComments, buildJobRows } from "@/lib/pipeline/job-builder";
import { severityOf, type JobErrorCategory, type JobErrorSeverity } from "@/lib/automation/errors";
import type {
  CampaignPost,
  CampaignJob,
  CampaignJobWithAvatar,
  Campaign,
  CampaignPlatform,
  JobVerification,
} from "@/types";
import type { PipelinePost } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// Read — Campaign posts and jobs (session-scoped)
//
// Both list endpoints are paginated with a composite (created_at, id) keyset
// cursor:
//   - `limit`         controls the page size (server-bounded by MAX_PAGE_SIZE)
//   - `before` (opt)  the {created_at, id} of the oldest row on the previous
//                     page; the next call returns rows strictly "older" than
//                     that cursor.
//
// The composite cursor is required because the pipeline inserts multiple jobs
// in a single transaction — those rows share the exact same `created_at`. A
// pure `created_at` cursor would skip every row tied at the page boundary.
// Ordering by (created_at DESC, id DESC) gives a stable, total order.
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface KeysetCursor {
  /** ISO timestamp from the row's `created_at`. */
  createdAt: string;
  /** Row id (UUID). */
  id: string;
}

interface ListPaginationOptions {
  limit?: number;
  before?: KeysetCursor;
}

function clampLimit(value: number | undefined): number {
  if (!value || value <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(value, MAX_PAGE_SIZE);
}

/** Builds the PostgREST `or()` filter for a "strictly before" composite cursor. */
function beforeCursorFilter({ createdAt, id }: KeysetCursor): string {
  // (created_at < cursor.created_at) OR (created_at = cursor.created_at AND id < cursor.id)
  return `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`;
}

export async function getCampaignPosts(
  campaignId: string,
  options: ListPaginationOptions = {},
): Promise<CampaignPost[]> {
  const session = await requireSession();
  const supabase = createAdminClient();

  let query = supabase
    .from("campaign_posts")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(clampLimit(options.limit));

  if (options.before) {
    query = query.or(beforeCursorFilter(options.before));
  }

  if (session.profile.role !== "admin") {
    query = query.eq("account_id", session.profile.account_id);
  }

  const { data } = await query;
  return (data ?? []) as CampaignPost[];
}

interface JobListOptions extends ListPaginationOptions {
  statusFilter?: string[];
}

export async function getCampaignJobs(
  campaignId: string,
  options: JobListOptions = {},
): Promise<CampaignJobWithAvatar[]> {
  const session = await requireSession();
  const supabase = createAdminClient();

  let query = supabase
    .from("campaign_jobs")
    .select("*, avatars:avatar_id(first_name, last_name)")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(clampLimit(options.limit));

  if (options.before) {
    query = query.or(beforeCursorFilter(options.before));
  }

  if (session.profile.role !== "admin") {
    query = query.eq("account_id", session.profile.account_id);
  }

  if (options.statusFilter && options.statusFilter.length > 0) {
    query = query.in("status", options.statusFilter);
  }

  const { data } = await query;

  return (data ?? []).map((row) => {
    const { avatars, ...job } = row as Record<string, unknown>;
    const av = avatars as { first_name: string; last_name: string } | null;
    return {
      ...job,
      avatar_name: av ? `${av.first_name} ${av.last_name}` : null,
    } as CampaignJobWithAvatar;
  });
}

export async function getJobQueue(boxId?: string): Promise<CampaignJob[]> {
  const session = await requireSession();
  const supabase = createAdminClient();

  let query = supabase
    .from("campaign_jobs")
    .select("*")
    .in("status", ["ready", "executing"])
    .order("scheduled_at", { ascending: true })
    .limit(100);

  if (session.profile.role !== "admin") {
    query = query.eq("account_id", session.profile.account_id);
  }

  if (boxId) {
    query = query.eq("box_id", boxId);
  }

  const { data } = await query;
  return (data ?? []) as CampaignJob[];
}

// ---------------------------------------------------------------------------
// Campaign stats — live job breakdown (network / verification / failures)
//
// Backs the automator stats panel. The 4 headline counters on the campaign row
// are the cumulative lifetime funnel; this is the live delivery detail the
// counters can't express: which network is producing, how many "published"
// posts are independently confirmed vs silent-drops, and — most actionable for
// an operator — how many failures they must personally fix (logged-out
// accounts, un-provisioned devices) vs the ones the system retries itself.
// ---------------------------------------------------------------------------

export interface NetworkBreakdown {
  platform: CampaignPlatform;
  done: number;
  failed: number;
  pending: number;
}

export interface FailureCategoryStat {
  category: JobErrorCategory;
  severity: JobErrorSeverity;
  count: number;
}

export interface CampaignStats {
  networks: NetworkBreakdown[];
  verification: Record<JobVerification, number>;
  totalDone: number;
  totalFailed: number;
  totalPending: number;
  failures: FailureCategoryStat[];
  /** Failures grouped by what the operator should do about them. */
  buckets: Record<JobErrorSeverity, number>;
}

interface RawJobStats {
  by_platform_status: { platform: string; status: string; n: number }[];
  verification: { verification: string; n: number }[];
  errors: { category: string; n: number }[];
}

const PENDING_STATUSES = new Set(["ready", "executing"]);

export async function getCampaignStats(campaignId: string): Promise<CampaignStats> {
  const session = await requireSession();
  const supabase = createAdminClient();

  // Tenant guard: a non-admin may only read stats for their own account's
  // campaign (mirrors the list endpoints above).
  if (session.profile.role !== "admin") {
    const { data: owned } = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", campaignId)
      .eq("account_id", session.profile.account_id)
      .maybeSingle();
    if (!owned) return emptyStats();
  }

  const { data, error } = await supabase.rpc("campaign_job_stats", { p_campaign_id: campaignId });
  if (error || !data) return emptyStats();

  return shapeStats(data as unknown as RawJobStats);
}

function emptyStats(): CampaignStats {
  return {
    networks: [],
    verification: { unchecked: 0, confirmed: 0, unconfirmed: 0 },
    totalDone: 0,
    totalFailed: 0,
    totalPending: 0,
    failures: [],
    buckets: { action_required: 0, transient: 0, terminal: 0, bug: 0 },
  };
}

function shapeStats(raw: RawJobStats): CampaignStats {
  const stats = emptyStats();
  const byPlatform = new Map<CampaignPlatform, NetworkBreakdown>();

  for (const row of raw.by_platform_status ?? []) {
    const platform = row.platform as CampaignPlatform;
    const entry = byPlatform.get(platform) ?? { platform, done: 0, failed: 0, pending: 0 };
    if (row.status === "done") { entry.done += row.n; stats.totalDone += row.n; }
    else if (row.status === "failed") { entry.failed += row.n; stats.totalFailed += row.n; }
    else if (PENDING_STATUSES.has(row.status)) { entry.pending += row.n; stats.totalPending += row.n; }
    byPlatform.set(platform, entry);
  }
  stats.networks = [...byPlatform.values()].sort((a, b) => a.platform.localeCompare(b.platform));

  for (const row of raw.verification ?? []) {
    if (row.verification in stats.verification) {
      stats.verification[row.verification as JobVerification] = row.n;
    }
  }

  for (const row of raw.errors ?? []) {
    const category = (isKnownCategory(row.category) ? row.category : "unknown") as JobErrorCategory;
    const severity = severityOf(category);
    stats.failures.push({ category, severity, count: row.n });
    stats.buckets[severity] += row.n;
  }
  stats.failures.sort((a, b) => b.count - a.count);

  return stats;
}

const KNOWN_CATEGORIES = new Set<JobErrorCategory>([
  "container_not_ready", "infrastructure", "app_not_ready", "device_setup_required",
  "consent_required", "account_logged_out", "account_blocked", "account_captcha",
  "rate_limited", "content_unavailable", "ui_unexpected", "unknown",
]);

function isKnownCategory(value: string): value is JobErrorCategory {
  return KNOWN_CATEGORIES.has(value as JobErrorCategory);
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function getQueueStats(): Promise<{
  totalReady: number;
  totalExecuting: number;
  byBox: { box_id: string; ready: number; executing: number }[];
}> {
  await requireSession();
  const supabase = createAdminClient();

  const { data: jobs } = await supabase
    .from("campaign_jobs")
    .select("box_id, status")
    .in("status", ["ready", "executing"]);

  const byBox = new Map<string, { ready: number; executing: number }>();
  let totalReady = 0;
  let totalExecuting = 0;

  for (const job of jobs ?? []) {
    const entry = byBox.get(job.box_id) ?? { ready: 0, executing: 0 };
    if (job.status === "ready") {
      entry.ready++;
      totalReady++;
    } else {
      entry.executing++;
      totalExecuting++;
    }
    byBox.set(job.box_id, entry);
  }

  return {
    totalReady,
    totalExecuting,
    byBox: Array.from(byBox.entries()).map(([box_id, counts]) => ({ box_id, ...counts })),
  };
}

// ---------------------------------------------------------------------------
// Actions — cancel, purge (admin only)
// ---------------------------------------------------------------------------

export async function cancelJob(jobId: string): Promise<void> {
  await requireAdmin();
  const supabase = createAdminClient();
  await supabase
    .from("campaign_jobs")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", jobId)
    .in("status", ["ready"]);
}

export async function purgeQueue(campaignId: string): Promise<number> {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("campaign_jobs")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("campaign_id", campaignId)
    .eq("status", "ready")
    .select("id, account_id");

  const count = data?.length ?? 0;
  if (count > 0) {
    broadcastCampaignEvent(campaignId, "pipeline", { action: "jobs_purged", count });
    const accountId = data?.[0]?.account_id;
    if (accountId) broadcastAccountEvent(accountId, "jobs", { action: "jobs_purged" });
  }
  return count;
}

export async function purgeBoxQueue(boxId: string): Promise<number> {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("campaign_jobs")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("box_id", boxId)
    .eq("status", "ready")
    .select("id");

  return data?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Awaiting avatars — retry and purge
// ---------------------------------------------------------------------------

export async function retryAwaitingPost(
  postId: string,
): Promise<{ success: boolean; message: string; jobsCreated: number }> {
  await requireAdmin();
  const supabase = createAdminClient();

  const { data: post } = await supabase
    .from("campaign_posts")
    .select("*, campaign:campaigns(*)")
    .eq("id", postId)
    .eq("status", "awaiting_avatars")
    .single();

  if (!post) {
    return { success: false, message: "Post not found or not awaiting", jobsCreated: 0 };
  }

  const campaign = post.campaign as Campaign;
  const platform = post.platform as "twitter" | "tiktok";
  const platformParams = campaign.capacity_params[platform];

  const selected = await selectAvatars({
    armyIds: campaign.army_ids,
    platform,
    capacityParams: platformParams,
    requestedCount: post.ai_decision?.suggested_avatar_count ?? 2,
    accountId: campaign.account_id,
  });

  if (selected.length === 0) {
    return { success: false, message: "Still no avatars available", jobsCreated: 0 };
  }

  const pipelinePost: PipelinePost = {
    id: post.source_id,
    posted_at: post.processed_at ?? post.created_at,
    zone_id: campaign.gorgone_zone_id,
    account_id: campaign.account_id,
    platform,
    post_url: post.post_url,
    post_text: post.post_text,
    post_author: post.post_author,
    author_followers: 0,
    author_verified: false,
    total_engagement: 0,
    language: null,
    collected_at: post.created_at,
    raw_metrics: post.post_metrics ?? {},
  };

  const guideline = {
    operational_context: campaign.operational_context,
    strategy: campaign.strategy,
    key_messages: campaign.key_messages,
  };

  const generatedComments = await generateComments({
    post: pipelinePost, selected, platform, guideline, supabase,
  });

  const jobs = buildJobRows({
    comments: generatedComments,
    campaignId: campaign.id,
    campaignPostId: post.id,
    accountId: campaign.account_id,
    platform,
    postUrl: post.post_url ?? "",
    capacityParams: platformParams,
  });

  const { error: jobsError } = await supabase.from("campaign_jobs").insert(jobs);
  if (jobsError) {
    return { success: false, message: `Failed to create jobs: ${jobsError.message}`, jobsCreated: 0 };
  }

  await supabase
    .from("campaign_posts")
    .update({ status: "responded", processed_at: new Date().toISOString() })
    .eq("id", post.id);

  await supabase.rpc("increment_campaign_counter", {
    p_campaign_id: campaign.id,
    p_counter: "total_posts_ingested",
  });

  broadcastCampaignEvent(campaign.id, "pipeline", { action: "post_retried", jobsCreated: jobs.length });
  broadcastCampaignEvent(campaign.id, "counters", { action: "ingested" });
  broadcastAccountEvent(campaign.account_id, "jobs", { action: "jobs_created" });

  return { success: true, message: `Created ${jobs.length} jobs`, jobsCreated: jobs.length };
}

export async function purgeAwaitingPosts(campaignId: string): Promise<number> {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("campaign_posts")
    .update({ status: "filtered_out" })
    .eq("campaign_id", campaignId)
    .eq("status", "awaiting_avatars")
    .select("id");

  const count = data?.length ?? 0;
  if (count > 0) {
    broadcastCampaignEvent(campaignId, "pipeline", { action: "posts_purged", count });
  }
  return count;
}
