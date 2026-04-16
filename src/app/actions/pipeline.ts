"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession, requireAdmin } from "@/lib/auth/session";
import { selectAvatars } from "@/lib/pipeline/avatar-selector";
import { generateComments, buildJobRows } from "@/lib/pipeline/job-builder";
import type { CampaignPost, CampaignJob, CampaignJobWithAvatar, Campaign } from "@/types";
import type { PipelinePost } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// Read — Campaign posts and jobs (session-scoped)
// ---------------------------------------------------------------------------

export async function getCampaignPosts(campaignId: string): Promise<CampaignPost[]> {
  const session = await requireSession();
  const supabase = createAdminClient();

  let query = supabase
    .from("campaign_posts")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (session.profile.role !== "admin") {
    query = query.eq("account_id", session.profile.account_id);
  }

  const { data } = await query;
  return (data ?? []) as CampaignPost[];
}

export async function getCampaignJobs(
  campaignId: string,
  statusFilter?: string[],
): Promise<CampaignJobWithAvatar[]> {
  const session = await requireSession();
  const supabase = createAdminClient();

  let query = supabase
    .from("campaign_jobs")
    .select("*, avatars:avatar_id(first_name, last_name)")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (session.profile.role !== "admin") {
    query = query.eq("account_id", session.profile.account_id);
  }

  if (statusFilter && statusFilter.length > 0) {
    query = query.in("status", statusFilter);
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
    .select("id");

  return data?.length ?? 0;
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

  return data?.length ?? 0;
}
