import { createAdminClient } from "@/lib/supabase/admin";
import { broadcastCampaignEvent, broadcastAccountEvent } from "@/lib/supabase/realtime";
import { fetchFullGorgonePost } from "@/lib/gorgone";
import {
  SUPPORTED_GORGONE_NETWORKS,
  type AnalystDecision,
  type Campaign,
  type CampaignPlatform,
  type GorgoneNetwork,
} from "@/types";
import type { PipelinePost, PipelineResult, PipelineTiming } from "./types";
import { pipelineLog, pipelineError } from "./types";
import { applyFilters } from "./filter";
import { analyzePost } from "./analyst";
import { fetchPostImage } from "./post-image";
import { selectAvatars } from "./avatar-selector";
import { generateComments, buildJobRows } from "./job-builder";
import type { FullGorgonePost } from "@/lib/gorgone";

/**
 * Process the next pending job from `gorgone_post_jobs`. Returns null when
 * no jobs are available.
 *
 * Flow (V4):
 *   1. CLEANUP — expire stale `awaiting_avatars` campaign_posts.
 *   2. CLAIM   — `claim_pending_job` RPC atomically picks the highest-
 *                engagement pending row and marks it 'processing'.
 *   3. FETCH   — re-fetch the full Gorgone post (with author + extras +
 *                AI sidecars) so the pipeline has everything it needs in
 *                one place. ~3-5 ms intra-Frankfurt.
 *   4. MATCH   — find the active campaign for the (account, zone, platform).
 *   5. FILTER  — apply rule-based campaign filters.
 *   6. ANALYST — LLM relevance check (skipped on high-confidence sentiment).
 *   7. SELECTOR/WRITER/INSERT — unchanged from V3.
 *
 * If the upstream post is gone (deleted_at), we mark the job 'expired' and
 * skip — same code path as 'filtered_out' but with a typed reason.
 */
export async function processNext(): Promise<PipelineResult | null> {
  const timing: PipelineTiming = { totalMs: 0 };
  const totalStart = Date.now();
  const supabase = createAdminClient();

  await expireAwaitingPosts(supabase);

  const claim = await claimNextJob(supabase);
  if (!claim) return null;

  const { jobId, postedAt, network, accountId } = claim;

  pipelineLog("claim", jobId, `Claimed job network=${network}`);

  try {
    // FETCH — re-fetch full payload from Gorgone (single source of truth)
    const fullPost = await fetchFullGorgonePost(jobId, postedAt);
    if (!fullPost) {
      pipelineLog("claim", jobId, "Upstream post gone — marking expired");
      await markJob(supabase, jobId, "expired", null, "post deleted upstream");
      return result("skipped", jobId, null, 0, timing, totalStart);
    }

    // Only twitter / tiktok have automation modules today; everything else
    // is filtered out cheaply at this stage.
    const platform = networkToPlatform(network);
    if (!platform) {
      await markJob(supabase, jobId, "filtered_out", null, "platform not supported");
      return result("filtered_rules", jobId, null, 0, timing, totalStart);
    }

    const post = fullPostToPipelinePost(fullPost, accountId, platform);

    // MATCH — active campaign for this (account, zone, platform)
    const campaign = await findCampaignForPost(supabase, post);
    if (!campaign) {
      await markJob(supabase, jobId, "filtered_out", null, "no active campaign for zone");
      return result("skipped", jobId, null, 0, timing, totalStart);
    }
    pipelineLog("match", jobId, `Matched campaign: ${campaign.name}`, { campaignId: campaign.id });

    // FILTER
    const filterStart = Date.now();
    const filterResult = applyFilters(post, campaign.filters);
    timing.filterMs = Date.now() - filterStart;

    if (!filterResult.passed) {
      pipelineLog("filter", jobId, `Filtered out: ${filterResult.reason}`);
      await markJob(supabase, jobId, "filtered_out", campaign.id, filterResult.reason ?? null);
      await incrementCampaignCounter(supabase, campaign.id, "total_posts_filtered");
      broadcastCampaignEvent(campaign.id, "counters", { action: "filtered" });
      return result("filtered_rules", jobId, campaign.id, 0, timing, totalStart);
    }

    // ANALYST — vision LLM relevance check. The post's still image (TikTok
    // cover / Twitter media) is fetched once here and shared with the writer;
    // a dead CDN link just downgrades both stages to text-only.
    const analystStart = Date.now();
    const postImage = await fetchPostImage(post.image_url, jobId);
    const decision = await analyzePost(post, {
      operational_context: campaign.operational_context,
      strategy: campaign.strategy,
      key_messages: campaign.key_messages,
    }, postImage);
    timing.analystMs = Date.now() - analystStart;

    if (!decision.relevant) {
      pipelineLog("analyst", jobId, `AI filtered: ${decision.reason}`);
      await markJob(supabase, jobId, "filtered_out", campaign.id, decision.reason ?? null);
      await incrementCampaignCounter(supabase, campaign.id, "total_posts_filtered");
      broadcastCampaignEvent(campaign.id, "counters", { action: "filtered" });
      return result("filtered_ai", jobId, campaign.id, 0, timing, totalStart);
    }

    // SELECTOR
    const selectorStart = Date.now();
    const platformParams = campaign.capacity_params[platform];
    const selected = await selectAvatars({
      armyIds: campaign.army_ids,
      platform,
      capacityParams: platformParams,
      requestedCount: decision.suggested_avatar_count,
      accountId: campaign.account_id,
    });
    timing.selectorMs = Date.now() - selectorStart;

    if (selected.length === 0) {
      pipelineLog("selector", jobId, "No avatars available — saving as awaiting_avatars");
      // Capture insert error explicitly — a CHECK / FK violation here
      // used to fail silently (the awaiting_avatars status was not in
      // the CHECK list before 2026-05-20), so the ledger reported
      // "processed" while no campaign_post existed.
      const { error: insertErr } = await supabase
        .from("campaign_posts")
        .insert(buildCampaignPostRow({
          campaign,
          post,
          jobId,
          network,
          platform,
          decision,
          status: "awaiting_avatars",
        }));
      if (insertErr) {
        throw new Error(`campaign_posts insert (awaiting_avatars) failed: ${insertErr.message}`);
      }
      await markJob(supabase, jobId, "processed", campaign.id, null);
      broadcastCampaignEvent(campaign.id, "pipeline", { action: "post_awaiting" });
      return result("no_avatars", jobId, campaign.id, 0, timing, totalStart);
    }

    // WRITER
    const writerStart = Date.now();
    const guideline = {
      operational_context: campaign.operational_context,
      strategy: campaign.strategy,
      key_messages: campaign.key_messages,
    };
    const generatedComments = await generateComments({
      post, selected, platform, guideline, supabase, postImage,
    });
    timing.writerMs = Date.now() - writerStart;

    // INSERT
    const insertStart = Date.now();
    const { data: campaignPost, error: cpInsertErr } = await supabase
      .from("campaign_posts")
      .insert(buildCampaignPostRow({
        campaign,
        post,
        jobId,
        network,
        platform,
        decision,
        status: "responded",
      }))
      .select("id")
      .single();

    if (cpInsertErr || !campaignPost) {
      const detail = cpInsertErr?.message ?? "no row returned";
      throw new Error(`campaign_posts insert (responded) failed: ${detail}`);
    }

    const jobs = buildJobRows({
      comments: generatedComments,
      campaignId: campaign.id,
      campaignPostId: campaignPost.id,
      accountId: campaign.account_id,
      platform,
      postUrl: post.post_url ?? "",
      capacityParams: platformParams,
    });

    const { error: jobsError } = await supabase.from("campaign_jobs").insert(jobs);
    if (jobsError) throw new Error(`Failed to insert jobs: ${jobsError.message}`);

    timing.insertMs = Date.now() - insertStart;

    await markJob(supabase, jobId, "processed", campaign.id, null);
    await incrementCampaignCounter(supabase, campaign.id, "total_posts_ingested");

    broadcastCampaignEvent(campaign.id, "pipeline", { action: "post_created", jobsCreated: jobs.length });
    broadcastCampaignEvent(campaign.id, "counters", { action: "ingested" });
    broadcastAccountEvent(campaign.account_id, "jobs", { action: "jobs_created" });

    pipelineLog("insert", jobId, "Pipeline complete", {
      campaignId: campaign.id,
      jobsCreated: jobs.length,
      totalMs: Date.now() - totalStart,
    });

    return result("responded", jobId, campaign.id, jobs.length, timing, totalStart);
  } catch (err) {
    const phase = getPhaseFromTiming(timing);
    pipelineError(phase, jobId, "Pipeline failed", err);
    const errMsg = err instanceof Error ? err.message : String(err);
    // Transient failures (LLM timeout / provider 5xx / network) must not
    // terminally drop a post — re-queue it with a bounded attempt count so it
    // is retried once the provider recovers. Only give up (`error`) once the
    // failure is non-transient or the retry budget is exhausted.
    const requeued = await requeueIfTransient(supabase, jobId, err, errMsg);
    if (!requeued) await markJob(supabase, jobId, "error", null, errMsg);
    return {
      success: false,
      action: "error",
      postId: jobId,
      campaignId: null,
      jobsCreated: 0,
      error: errMsg,
      phase,
      timing: { ...timing, totalMs: Date.now() - totalStart },
    };
  }
}

// ---------------------------------------------------------------------------
// Transient-failure retry — bounded, uses the ledger's `attempts` column
// ---------------------------------------------------------------------------

const MAX_PIPELINE_ATTEMPTS = 5;

/** Failures worth retrying: the LLM provider timed out, rate-limited, or 5xx'd,
 * or the network blipped. Editorial/validation errors are NOT transient. */
function isTransientPipelineError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("fetch failed") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("network") ||
    /\b(429|500|502|503|504)\b/.test(msg)
  );
}

/**
 * On a transient failure, set the ledger row back to `pending` and increment
 * `attempts` (so a later cycle re-claims it) — up to `MAX_PIPELINE_ATTEMPTS`.
 * Returns true when the post was re-queued, false when it should be terminally
 * marked `error` (non-transient, or retry budget spent).
 */
async function requeueIfTransient(
  supabase: ReturnType<typeof createAdminClient>,
  jobId: string,
  err: unknown,
  errMsg: string,
): Promise<boolean> {
  if (!isTransientPipelineError(err)) return false;

  const { data: row } = await supabase
    .from("gorgone_post_jobs")
    .select("attempts")
    .eq("gorgone_post_id", jobId)
    .single();

  const attempts = (row?.attempts ?? 0) + 1;
  if (attempts >= MAX_PIPELINE_ATTEMPTS) {
    pipelineLog("claim", jobId, `Transient failure but retry budget spent (${attempts}) — marking error`);
    return false;
  }

  const { error } = await supabase
    .from("gorgone_post_jobs")
    .update({
      status: "pending",
      attempts,
      error_message: `retry ${attempts}/${MAX_PIPELINE_ATTEMPTS}: ${errMsg.slice(0, 200)}`,
      status_changed_at: new Date().toISOString(),
    })
    .eq("gorgone_post_id", jobId);

  if (error) {
    pipelineError("claim", jobId, "Failed to re-queue transient post", error);
    return false;
  }
  pipelineLog("claim", jobId, `Transient failure — re-queued (attempt ${attempts}/${MAX_PIPELINE_ATTEMPTS})`);
  return true;
}

// ---------------------------------------------------------------------------
// Claim — claim_pending_job RPC (FOR UPDATE SKIP LOCKED)
// ---------------------------------------------------------------------------

interface ClaimedJob {
  jobId: string;
  postedAt: string;
  accountId: string;
  zoneId: string;
  network: GorgoneNetwork;
}

async function claimNextJob(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<ClaimedJob | null> {
  const { data, error } = await supabase.rpc("claim_pending_job", {
    p_zone_ids: null,
    // Only platforms with an avatar-automation module today.
    p_networks: [...SUPPORTED_GORGONE_NETWORKS],
  });

  if (error || !data || data.length === 0) return null;

  const row = data[0] as {
    gorgone_post_id: string;
    gorgone_post_posted_at: string;
    account_id: string;
    zone_id: string;
    network: GorgoneNetwork;
  };

  return {
    jobId: row.gorgone_post_id,
    postedAt: row.gorgone_post_posted_at,
    accountId: row.account_id,
    zoneId: row.zone_id,
    network: row.network,
  };
}

// ---------------------------------------------------------------------------
// campaign_posts row builder — single source of truth for the columns we
// write at every INSERT site (awaiting_avatars + responded paths). Keeping
// the shape in one place means new columns flow through both code paths
// without drift.
// ---------------------------------------------------------------------------

interface BuildCampaignPostRowInput {
  campaign: Campaign;
  post: PipelinePost;
  jobId: string;
  network: GorgoneNetwork;
  platform: CampaignPlatform;
  decision: AnalystDecision;
  status: "awaiting_avatars" | "responded";
}

function buildCampaignPostRow(input: BuildCampaignPostRowInput) {
  const { campaign, post, jobId, network, platform, decision, status } = input;
  return {
    campaign_id: campaign.id,
    account_id: campaign.account_id,
    source_table: "gorgone_post_jobs" as const,
    source_id: jobId,
    source_network: network,
    platform,
    post_url: post.post_url,
    post_text: post.post_text,
    post_author: post.post_author,
    post_metrics: post.raw_metrics,
    ai_decision: decision,
    status,
    processed_at: new Date().toISOString(),
    // Gorgone V4 enrichments — null-safe; columns are nullable.
    sentiment_label: post.sentiment_label ?? null,
    sentiment_score: post.sentiment_score ?? null,
    translation_text: post.translation_text ?? null,
    translation_lang: post.translation_lang ?? null,
    source_posted_at: post.posted_at,
  };
}

// ---------------------------------------------------------------------------
// Mapping: full Gorgone post -> pipeline-shape post
// ---------------------------------------------------------------------------

function networkToPlatform(network: GorgoneNetwork): CampaignPlatform | null {
  if (network === "twitter" || network === "tiktok") return network;
  return null;
}

function fullPostToPipelinePost(
  full: FullGorgonePost,
  accountId: string,
  platform: CampaignPlatform,
): PipelinePost {
  const isReply = full.is_reply;
  const isRepost = full.is_repost;

  const rawMetrics: Record<string, unknown> = platform === "twitter"
    ? {
        retweet_count: full.retweets,
        reply_count: full.replies,
        like_count: full.likes,
        quote_count: full.quotes,
        view_count: full.views,
        total_engagement: full.total_engagement,
      }
    : {
        // TikTok column mapping (V4 stores plays as `views`, diggs as `likes`,
        // comments as `replies`, shares as `retweets`, saves as `bookmarks`
        // on the unified posts row).
        play_count: full.views,
        digg_count: full.likes,
        comment_count: full.replies,
        share_count: full.retweets,
        collect_count: full.bookmarks,
        total_engagement: full.total_engagement,
      };

  return {
    id: full.id,
    posted_at: full.posted_at,
    zone_id: full.zone_id,
    account_id: accountId,
    platform,
    post_url: full.post_url,
    post_text: full.text,
    post_author: full.author_handle,
    image_url: full.image_url,
    author_followers: full.author_followers,
    author_verified: full.author_verified,
    total_engagement: full.total_engagement,
    language: full.lang,
    collected_at: full.first_seen_at,
    is_reply: isReply,
    is_ad: full.is_ad,
    author_is_private: full.author_is_private,
    post_type: isReply ? "reply" : isRepost ? "retweet" : "post",
    sentiment_label: full.sentiment_label,
    sentiment_score: full.sentiment_score,
    translation_text: full.translation_text,
    translation_lang: full.translation_lang,
    raw_metrics: rawMetrics,
  };
}

// ---------------------------------------------------------------------------
// Campaign matching
// ---------------------------------------------------------------------------

async function findCampaignForPost(
  supabase: ReturnType<typeof createAdminClient>,
  post: PipelinePost,
): Promise<Campaign | null> {
  const { data } = await supabase
    .from("campaigns")
    .select("*")
    .eq("status", "active")
    .eq("gorgone_zone_id", post.zone_id)
    .eq("account_id", post.account_id)
    .contains("platforms", [post.platform])
    .limit(1)
    .maybeSingle();

  return (data as Campaign | null) ?? null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function markJob(
  supabase: ReturnType<typeof createAdminClient>,
  jobId: string,
  status: "processed" | "filtered_out" | "error" | "expired",
  campaignId: string | null,
  errorMessage: string | null,
) {
  await supabase
    .from("gorgone_post_jobs")
    .update({
      status,
      campaign_id: campaignId,
      error_message: errorMessage,
    })
    .eq("gorgone_post_id", jobId);
}

async function incrementCampaignCounter(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  counter: "total_posts_ingested" | "total_posts_filtered" | "total_responses_sent" | "total_responses_failed",
) {
  await supabase.rpc("increment_campaign_counter", {
    p_campaign_id: campaignId,
    p_counter: counter,
  });
}

function result(
  action: PipelineResult["action"],
  postId: string,
  campaignId: string | null,
  jobsCreated: number,
  timing: PipelineTiming,
  totalStart: number,
): PipelineResult {
  return {
    success: action === "responded" || action === "filtered_rules" || action === "filtered_ai" || action === "skipped",
    action,
    postId,
    campaignId,
    jobsCreated,
    timing: { ...timing, totalMs: Date.now() - totalStart },
  };
}

function getPhaseFromTiming(timing: PipelineTiming): "claim" | "match" | "filter" | "analyst" | "selector" | "writer" | "insert" {
  if (timing.insertMs != null) return "insert";
  if (timing.writerMs != null) return "writer";
  if (timing.selectorMs != null) return "selector";
  if (timing.analystMs != null) return "analyst";
  if (timing.filterMs != null) return "filter";
  return "match";
}

// ---------------------------------------------------------------------------
// Expire old awaiting_avatars posts (default 2 hours)
// ---------------------------------------------------------------------------

const DEFAULT_AWAIT_TTL_MINUTES = 120;

async function expireAwaitingPosts(
  supabase: ReturnType<typeof createAdminClient>,
) {
  const cutoff = new Date(Date.now() - DEFAULT_AWAIT_TTL_MINUTES * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("campaign_posts")
    .update({ status: "filtered_out" })
    .eq("status", "awaiting_avatars")
    .lt("created_at", cutoff)
    .select("id");

  if (data && data.length > 0) {
    pipelineLog("cleanup", null, `Expired ${data.length} awaiting_avatars posts older than ${DEFAULT_AWAIT_TTL_MINUTES}min`);
  }
}
