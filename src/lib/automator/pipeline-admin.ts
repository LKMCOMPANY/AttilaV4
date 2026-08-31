import type { RequestSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { broadcastCampaignEvent, broadcastAccountEvent } from "@/lib/supabase/realtime";
import { selectAvatars } from "@/lib/pipeline/avatar-selector";
import { generateComments, buildJobRows } from "@/lib/pipeline/job-builder";
import type { Campaign } from "@/types";
import type { PipelinePost } from "@/lib/pipeline/types";

/**
 * Admin pipeline cores — the single implementation behind the Server
 * Actions (`src/app/actions/pipeline.ts`) and the native REST routes
 * (`/api/campaigns/[id]/…`, `/api/campaign-posts/[id]/retry`).
 *
 * All three operate cross-tenant on the service-role client, so they
 * gate on the admin role explicitly (parity with `requireAdmin()`); the
 * throw is mapped to 403 by `nativeRoute` on the bearer transport.
 */

function assertAdmin(ctx: RequestSession): void {
  if (ctx.session.profile.role !== "admin") {
    throw new Error("Forbidden: admin access required");
  }
}

// ---------------------------------------------------------------------------
// Purge queue — cancel every `ready` job of a campaign
// ---------------------------------------------------------------------------

export async function purgeQueueCore(
  ctx: RequestSession,
  campaignId: string,
): Promise<number> {
  assertAdmin(ctx);
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

// ---------------------------------------------------------------------------
// Purge awaiting — park every `awaiting_avatars` post as filtered_out
// ---------------------------------------------------------------------------

export async function purgeAwaitingPostsCore(
  ctx: RequestSession,
  campaignId: string,
): Promise<number> {
  assertAdmin(ctx);
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

// ---------------------------------------------------------------------------
// Retry awaiting — re-run avatar selection + writer for one parked post
// ---------------------------------------------------------------------------

export interface RetryAwaitingResult {
  success: boolean;
  message: string;
  jobsCreated: number;
}

export async function retryAwaitingPostCore(
  ctx: RequestSession,
  postId: string,
): Promise<RetryAwaitingResult> {
  assertAdmin(ctx);
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
