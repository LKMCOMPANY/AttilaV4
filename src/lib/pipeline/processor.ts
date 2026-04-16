import { createAdminClient } from "@/lib/supabase/admin";
import type { Campaign, CampaignPlatform } from "@/types";
import type { PipelinePost, PipelineResult, PipelineTiming } from "./types";
import { pipelineLog, pipelineError } from "./types";
import { applyFilters } from "./filter";
import { analyzePost } from "./analyst";
import { selectAvatars } from "./avatar-selector";
import { writeComment } from "./writer";

/**
 * Process the next pending post. Returns null if no posts are available.
 * This is the core "pipe" — one post, end to end.
 *
 * Stale cleanup (posts stuck in 'processing') is NOT done here because the
 * gorgone tables lack a processing_started_at column — using collected_at
 * would incorrectly reset freshly-claimed old posts. Cleanup will be handled
 * at worker startup in the long-running worker (Option B).
 */
export async function processNext(): Promise<PipelineResult | null> {
  const timing: PipelineTiming = { totalMs: 0 };
  const totalStart = Date.now();
  const supabase = createAdminClient();

  // -------------------------------------------------------------------------
  // Phase: CLEANUP — expire old awaiting_avatars posts (> queue_max_age)
  // -------------------------------------------------------------------------
  await expireAwaitingPosts(supabase);

  // -------------------------------------------------------------------------
  // Phase: CLAIM — find and lock a pending post
  // -------------------------------------------------------------------------
  const claimed = await claimNextPost(supabase);
  if (!claimed) return null;

  const { post, platform } = claimed;
  pipelineLog("claim", post.id, `Claimed ${platform} post`, {
    author: post.post_author,
    engagement: post.total_engagement,
  });

  try {
    // -----------------------------------------------------------------------
    // Phase: MATCH — find active campaign for this zone
    // -----------------------------------------------------------------------
    const campaign = await findCampaignForPost(supabase, post, platform);
    if (!campaign) {
      await markPostStatus(supabase, post, platform, "filtered_out");
      return result("skipped", post.id, null, 0, timing, totalStart);
    }

    pipelineLog("match", post.id, `Matched campaign: ${campaign.name}`, { campaignId: campaign.id });

    // -----------------------------------------------------------------------
    // Phase: FILTER — apply rule-based filters
    // -----------------------------------------------------------------------
    const filterStart = Date.now();
    const filterResult = applyFilters(post, campaign.filters);
    timing.filterMs = Date.now() - filterStart;

    if (!filterResult.passed) {
      pipelineLog("filter", post.id, `Filtered out: ${filterResult.reason}`);
      await markPostStatus(supabase, post, platform, "filtered_out");
      await incrementCampaignCounter(supabase, campaign.id, "total_posts_filtered");
      return result("filtered_rules", post.id, campaign.id, 0, timing, totalStart);
    }

    // -----------------------------------------------------------------------
    // Phase: ANALYST — AI decides relevance + avatar count
    // -----------------------------------------------------------------------
    const analystStart = Date.now();
    const decision = await analyzePost(post, {
      operational_context: campaign.operational_context,
      strategy: campaign.strategy,
      key_messages: campaign.key_messages,
    });
    timing.analystMs = Date.now() - analystStart;

    if (!decision.relevant) {
      pipelineLog("analyst", post.id, `AI filtered: ${decision.reason}`);
      await markPostStatus(supabase, post, platform, "filtered_out");
      await incrementCampaignCounter(supabase, campaign.id, "total_posts_filtered");
      return result("filtered_ai", post.id, campaign.id, 0, timing, totalStart);
    }

    // -----------------------------------------------------------------------
    // Phase: SELECTOR — pick available avatars
    // -----------------------------------------------------------------------
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
      pipelineLog("selector", post.id, "No avatars available — saving as awaiting_avatars");

      await supabase.from("campaign_posts").insert({
        campaign_id: campaign.id,
        account_id: campaign.account_id,
        source_table: platform === "twitter" ? "gorgone_tweets" : "gorgone_tiktok_videos",
        source_id: post.id,
        platform,
        post_url: post.post_url,
        post_text: post.post_text,
        post_author: post.post_author,
        post_metrics: post.raw_metrics,
        ai_decision: decision,
        status: "awaiting_avatars",
        processed_at: new Date().toISOString(),
      });

      await markPostStatus(supabase, post, platform, "processed");
      return result("no_avatars", post.id, campaign.id, 0, timing, totalStart);
    }

    // -----------------------------------------------------------------------
    // Phase: WRITER — generate comments sequentially (cumulative context)
    // -----------------------------------------------------------------------
    const writerStart = Date.now();
    const guideline = {
      operational_context: campaign.operational_context,
      strategy: campaign.strategy,
      key_messages: campaign.key_messages,
    };

    const generatedComments: { avatarId: string; commentText: string; deviceId: string; boxId: string }[] = [];

    for (const sel of selected) {
      const recentComments = await getRecentAvatarComments(supabase, sel.avatar.id, 5);

      const writerResult = await writeComment({
        post,
        avatar: sel.avatar,
        platform,
        guideline,
        previousCommentsOnPost: generatedComments.map((c) => c.commentText),
        recentAvatarComments: recentComments,
      });

      generatedComments.push({
        avatarId: writerResult.avatarId,
        commentText: writerResult.commentText,
        deviceId: sel.device_id,
        boxId: sel.box_id,
      });
    }
    timing.writerMs = Date.now() - writerStart;

    // -----------------------------------------------------------------------
    // Phase: INSERT — create campaign_posts + campaign_jobs
    // -----------------------------------------------------------------------
    const insertStart = Date.now();

    const { data: campaignPost } = await supabase
      .from("campaign_posts")
      .insert({
        campaign_id: campaign.id,
        account_id: campaign.account_id,
        source_table: platform === "twitter" ? "gorgone_tweets" : "gorgone_tiktok_videos",
        source_id: post.id,
        platform,
        post_url: post.post_url,
        post_text: post.post_text,
        post_author: post.post_author,
        post_metrics: post.raw_metrics,
        ai_decision: decision,
        status: "responded",
        processed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (!campaignPost) throw new Error("Failed to insert campaign_post");

    // Calculate staggered scheduled_at — cumulative delays between avatars
    const delayMin = platformParams.delay_min_seconds ?? 30;
    const delayMax = Math.max(platformParams.delay_max_seconds ?? 120, delayMin);

    let cumulativeDelay = 0;
    const jobs = generatedComments.map((comment) => {
      cumulativeDelay += randomBetween(delayMin, delayMax);
      const scheduledAt = new Date(Date.now() + cumulativeDelay * 1000).toISOString();

      return {
        campaign_id: campaign.id,
        campaign_post_id: campaignPost.id,
        account_id: campaign.account_id,
        avatar_id: comment.avatarId,
        device_id: comment.deviceId,
        box_id: comment.boxId,
        platform,
        post_url: post.post_url ?? "",
        comment_text: comment.commentText,
        status: "ready" as const,
        scheduled_at: scheduledAt,
        queued_at: new Date().toISOString(),
      };
    });

    const { error: jobsError } = await supabase.from("campaign_jobs").insert(jobs);
    if (jobsError) throw new Error(`Failed to insert jobs: ${jobsError.message}`);

    timing.insertMs = Date.now() - insertStart;

    // Mark source post as responded
    await markPostStatus(supabase, post, platform, "processed");
    await incrementCampaignCounter(supabase, campaign.id, "total_posts_ingested");

    pipelineLog("insert", post.id, "Pipeline complete", {
      campaignId: campaign.id,
      jobsCreated: jobs.length,
      totalMs: Date.now() - totalStart,
    });

    return result("responded", post.id, campaign.id, jobs.length, timing, totalStart);
  } catch (err) {
    const phase = getPhaseFromTiming(timing);
    pipelineError(phase, post.id, "Pipeline failed", err);
    await markPostStatus(supabase, post, platform, "error");
    return {
      success: false,
      action: "error",
      postId: post.id,
      campaignId: null,
      jobsCreated: 0,
      error: err instanceof Error ? err.message : String(err),
      phase,
      timing: { ...timing, totalMs: Date.now() - totalStart },
    };
  }
}

// ---------------------------------------------------------------------------
// Claim — atomic post selection with FOR UPDATE SKIP LOCKED via RPC
// ---------------------------------------------------------------------------

async function claimNextPost(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<{ post: PipelinePost; platform: CampaignPlatform } | null> {
  // Try Twitter first, then TikTok
  const tweet = await claimFromTable(supabase, "gorgone_tweets", "twitter");
  if (tweet) return tweet;

  return claimFromTable(supabase, "gorgone_tiktok_videos", "tiktok");
}

async function claimFromTable(
  supabase: ReturnType<typeof createAdminClient>,
  table: "gorgone_tweets" | "gorgone_tiktok_videos",
  platform: CampaignPlatform,
): Promise<{ post: PipelinePost; platform: CampaignPlatform } | null> {
  // Use raw SQL for FOR UPDATE SKIP LOCKED (not supported by PostgREST)
  const { data, error } = await supabase.rpc("claim_pending_post", {
    p_table: table,
  });

  if (error || !data || data.length === 0) return null;

  const row = data[0];
  const post = platform === "twitter"
    ? tweetToPost(row)
    : tiktokToPost(row);

  return { post, platform };
}

function tweetToPost(row: Record<string, unknown>): PipelinePost {
  const isReply = Boolean(row.is_reply);
  const text = String(row.text ?? "");
  const isRetweet = text.startsWith("RT @");

  return {
    id: String(row.id),
    zone_id: String(row.zone_id),
    account_id: String(row.account_id),
    platform: "twitter",
    post_url: row.tweet_url as string | null,
    post_text: text,
    post_author: row.author_username as string | null,
    author_followers: Number(row.author_followers ?? 0),
    author_verified: Boolean(row.author_verified),
    total_engagement: Number(row.total_engagement ?? 0),
    language: row.lang as string | null,
    collected_at: String(row.collected_at),
    is_reply: isReply,
    post_type: isReply ? "reply" : isRetweet ? "retweet" : "post",
    raw_metrics: {
      retweet_count: row.retweet_count,
      reply_count: row.reply_count,
      like_count: row.like_count,
      quote_count: row.quote_count,
      view_count: row.view_count,
      total_engagement: row.total_engagement,
    },
  };
}

function tiktokToPost(row: Record<string, unknown>): PipelinePost {
  return {
    id: String(row.id),
    zone_id: String(row.zone_id),
    account_id: String(row.account_id),
    platform: "tiktok",
    post_url: row.share_url as string | null,
    post_text: String(row.description ?? ""),
    post_author: row.author_username as string | null,
    author_followers: Number(row.author_followers ?? 0),
    author_verified: Boolean(row.author_verified),
    total_engagement: Number(row.total_engagement ?? 0),
    language: row.language as string | null,
    collected_at: String(row.collected_at),
    is_ad: Boolean(row.is_ad),
    author_is_private: Boolean(row.author_is_private),
    raw_metrics: {
      play_count: row.play_count,
      digg_count: row.digg_count,
      comment_count: row.comment_count,
      share_count: row.share_count,
      collect_count: row.collect_count,
      total_engagement: row.total_engagement,
    },
  };
}

// ---------------------------------------------------------------------------
// Campaign matching
// ---------------------------------------------------------------------------

async function findCampaignForPost(
  supabase: ReturnType<typeof createAdminClient>,
  post: PipelinePost,
  platform: CampaignPlatform,
): Promise<Campaign | null> {
  const { data } = await supabase
    .from("campaigns")
    .select("*")
    .eq("status", "active")
    .eq("gorgone_zone_id", post.zone_id)
    .eq("account_id", post.account_id)
    .contains("platforms", [platform])
    .limit(1)
    .single();

  return data as Campaign | null;
}

// ---------------------------------------------------------------------------
// Recent avatar comments (for anti-repetition)
// ---------------------------------------------------------------------------

async function getRecentAvatarComments(
  supabase: ReturnType<typeof createAdminClient>,
  avatarId: string,
  limit: number,
): Promise<string[]> {
  const { data } = await supabase
    .from("campaign_jobs")
    .select("comment_text")
    .eq("avatar_id", avatarId)
    .in("status", ["ready", "executing", "done"])
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((j) => j.comment_text);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function markPostStatus(
  supabase: ReturnType<typeof createAdminClient>,
  post: PipelinePost,
  platform: CampaignPlatform,
  status: string,
) {
  const table = platform === "twitter" ? "gorgone_tweets" : "gorgone_tiktok_videos";
  await supabase.from(table).update({ status }).eq("id", post.id);
}

async function incrementCampaignCounter(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  counter: "total_posts_ingested" | "total_posts_filtered" | "total_responses_sent" | "total_responses_failed",
) {
  // Atomic increment via raw SQL
  await supabase.rpc("increment_campaign_counter", {
    p_campaign_id: campaignId,
    p_counter: counter,
  });
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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
