"use server";

/**
 * Campaign Network Graph — Server Action
 *
 * Builds a force-directed graph from campaign_posts + campaign_jobs.
 * Concentric structure:
 *   CENTER — Zone target (campaign.gorgone_zone_name)
 *   MIDDLE — Source posts (campaign_posts)
 *   OUTER  — Avatars (unique avatars from campaign_jobs)
 */

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import type {
  NetworkData,
  NetworkNode,
  NetworkLink,
  NetworkStats,
  NetworkJobStatus,
} from "@/types/network";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_POSTS = 200;
const ZONE_TARGET_SIZE = 20;
const POST_SIZE_MIN = 3;
const POST_SIZE_MAX = 10;
const AVATAR_SIZE_MIN = 4;
const AVATAR_SIZE_MAX = 10;

// ---------------------------------------------------------------------------
// Public action
// ---------------------------------------------------------------------------

export async function getNetworkData(
  campaignId: string
): Promise<{ data: NetworkData | null; error: string | null }> {
  try {
    const session = await requireSession();
    const supabase = await createClient();

    const { data: campaign, error: campErr } = await supabase
      .from("campaigns")
      .select("id, account_id, name, gorgone_zone_id, gorgone_zone_name")
      .eq("id", campaignId)
      .single();

    if (campErr || !campaign) {
      return { data: null, error: "Campaign not found" };
    }

    if (
      session.profile.role !== "admin" &&
      campaign.account_id !== session.profile.account_id
    ) {
      return { data: null, error: "Forbidden" };
    }

    const { data: posts, error: postsErr } = await supabase
      .from("campaign_posts")
      .select("id, post_url, post_text, post_author, post_metrics, status, platform")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(MAX_POSTS);

    if (postsErr) {
      return { data: null, error: postsErr.message };
    }

    const { data: jobs, error: jobsErr } = await supabase
      .from("campaign_jobs")
      .select(
        "id, campaign_post_id, avatar_id, status, avatar:avatars(id, first_name, last_name, profile_image_url, twitter_credentials)"
      )
      .eq("campaign_id", campaignId);

    if (jobsErr) {
      return { data: null, error: jobsErr.message };
    }

    const graphData = buildGraph(
      campaign as CampaignRow,
      (posts ?? []) as PostRow[],
      (jobs ?? []) as JobRow[]
    );

    return { data: graphData, error: null };
  } catch (err) {
    console.error("[Network] Error:", err);
    return {
      data: null,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

function buildGraph(
  campaign: CampaignRow,
  posts: PostRow[],
  jobs: JobRow[]
): NetworkData {
  const nodes: NetworkNode[] = [];
  const links: NetworkLink[] = [];
  const avatarMap = new Map<string, AvatarAccumulator>();

  let completedJobs = 0;
  let failedJobs = 0;

  // 1 — Zone target (center)
  const zoneNodeId = `zt_${campaign.gorgone_zone_id}`;
  nodes.push({
    id: zoneNodeId,
    label: campaign.gorgone_zone_name ?? campaign.name,
    type: "zone_target",
    value: ZONE_TARGET_SIZE,
    metadata: {
      zoneName: campaign.gorgone_zone_name ?? undefined,
      zoneId: campaign.gorgone_zone_id,
      campaignName: campaign.name,
    },
    fx: 0,
    fy: 0,
    fz: 0,
  });

  // Index jobs by post id for fast lookup
  const jobsByPost = new Map<string, JobRow[]>();
  for (const job of jobs) {
    const list = jobsByPost.get(job.campaign_post_id) ?? [];
    list.push(job);
    jobsByPost.set(job.campaign_post_id, list);
  }

  // 2 — Source posts (middle ring)
  for (const post of posts) {
    const postNodeId = `sp_${post.id}`;
    const postJobs = jobsByPost.get(post.id) ?? [];
    const engagement = extractEngagement(post.post_metrics);

    nodes.push({
      id: postNodeId,
      label: truncate(post.post_author ?? "Unknown", 15),
      type: "source_post",
      value: scaleValue(engagement, POST_SIZE_MIN, POST_SIZE_MAX),
      metadata: {
        authorUsername: post.post_author ?? undefined,
        postUrl: post.post_url ?? undefined,
        postText: truncate(post.post_text ?? "", 120),
        engagementCount: engagement,
        responseCount: postJobs.length,
        platform: post.platform,
        status: post.status,
      },
    });

    links.push({
      source: postNodeId,
      target: zoneNodeId,
      type: "mentions",
      value: 1,
    });

    // 3 — Process jobs → avatar nodes + links
    for (const job of postJobs) {
      const jobStatus = normalizeJobStatus(job.status);
      if (jobStatus === "done") completedJobs++;
      if (jobStatus === "failed") failedJobs++;

      const avatar = Array.isArray(job.avatar) ? job.avatar[0] : job.avatar;
      if (!avatar) continue;

      if (!avatarMap.has(avatar.id)) {
        const handle =
          (avatar.twitter_credentials as Record<string, string>)?.handle ?? null;
        avatarMap.set(avatar.id, {
          id: avatar.id,
          name: `${avatar.first_name} ${avatar.last_name}`.trim(),
          profileImageUrl: avatar.profile_image_url,
          twitterHandle: handle,
          responseCount: 0,
        });
      }
      avatarMap.get(avatar.id)!.responseCount++;

      links.push({
        source: `av_${avatar.id}`,
        target: postNodeId,
        type: "reply_to",
        value: jobStatus === "done" ? 2 : 1,
        status: jobStatus,
        jobId: job.id,
      });
    }
  }

  // 4 — Avatar nodes (outer ring)
  for (const [avatarId, acc] of avatarMap) {
    nodes.push({
      id: `av_${avatarId}`,
      label: truncate(acc.name, 12),
      type: "avatar",
      value: scaleValue(acc.responseCount, AVATAR_SIZE_MIN, AVATAR_SIZE_MAX),
      metadata: {
        avatarName: acc.name,
        twitterHandle: acc.twitterHandle ?? undefined,
        profileImageUrl: acc.profileImageUrl,
        responseCount: acc.responseCount,
      },
    });
  }

  const stats: NetworkStats = {
    totalPosts: posts.length,
    totalAvatars: avatarMap.size,
    totalJobs: jobs.length,
    completedJobs,
    failedJobs,
  };

  return { nodes, links, stats };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeJobStatus(raw: string): NetworkJobStatus {
  if (raw === "done") return "done";
  if (raw === "failed" || raw === "cancelled" || raw === "expired") return "failed";
  return "pending";
}

function extractEngagement(metrics: Record<string, unknown> | null): number {
  if (!metrics) return 0;
  let total = 0;
  for (const key of [
    "like_count",
    "view_count",
    "reply_count",
    "retweet_count",
    "play_count",
    "digg_count",
    "share_count",
    "comment_count",
  ]) {
    const v = metrics[key];
    if (typeof v === "number") total += v;
  }
  return total;
}

function scaleValue(metric: number, min: number, max: number): number {
  const log = Math.log10(Math.max(metric, 1) + 1);
  const normalized = Math.min(log / 3, 1);
  return min + normalized * (max - min);
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : `${text.slice(0, maxLen - 1)}…`;
}

// ---------------------------------------------------------------------------
// Internal row types
// ---------------------------------------------------------------------------

interface CampaignRow {
  id: string;
  account_id: string;
  name: string;
  gorgone_zone_id: string;
  gorgone_zone_name: string | null;
}

interface PostRow {
  id: string;
  post_url: string | null;
  post_text: string | null;
  post_author: string | null;
  post_metrics: Record<string, unknown> | null;
  status: string;
  platform: string;
}

interface AvatarRelation {
  id: string;
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
  twitter_credentials: unknown;
}

interface JobRow {
  id: string;
  campaign_post_id: string;
  avatar_id: string;
  status: string;
  avatar: AvatarRelation | AvatarRelation[] | null;
}

interface AvatarAccumulator {
  id: string;
  name: string;
  profileImageUrl: string | null;
  twitterHandle: string | null;
  responseCount: number;
}
