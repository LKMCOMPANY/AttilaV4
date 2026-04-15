"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession, requireAdmin } from "@/lib/auth/session";
import type { CampaignPost, CampaignJob, CampaignJobWithAvatar } from "@/types";

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
