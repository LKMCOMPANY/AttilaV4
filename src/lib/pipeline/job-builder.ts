import { createAdminClient } from "@/lib/supabase/admin";
import type { CampaignPlatform, PlatformCapacityParams } from "@/types";
import type { PipelinePost, SelectedAvatar } from "./types";
import { writeComment } from "./writer";

interface GeneratedComment {
  avatarId: string;
  commentText: string;
  deviceId: string;
  boxId: string;
}

/**
 * Generate comments for all selected avatars, sequentially for cumulative
 * anti-repetition context. Shared between processNext and retryAwaitingPost.
 */
export async function generateComments(params: {
  post: PipelinePost;
  selected: SelectedAvatar[];
  platform: CampaignPlatform;
  guideline: { operational_context: string | null; strategy: string | null; key_messages: string | null };
  supabase: ReturnType<typeof createAdminClient>;
}): Promise<GeneratedComment[]> {
  const { post, selected, platform, guideline, supabase } = params;
  const comments: GeneratedComment[] = [];

  for (const sel of selected) {
    const recentComments = await getRecentAvatarComments(supabase, sel.avatar.id, 5);

    const result = await writeComment({
      post,
      avatar: sel.avatar,
      platform,
      guideline,
      previousCommentsOnPost: comments.map((c) => c.commentText),
      recentAvatarComments: recentComments,
    });

    comments.push({
      avatarId: result.avatarId,
      commentText: result.commentText,
      deviceId: sel.device_id,
      boxId: sel.box_id,
    });
  }

  return comments;
}

/**
 * Build staggered job rows ready for insertion into campaign_jobs.
 * Shared between processNext and retryAwaitingPost.
 */
export function buildJobRows(params: {
  comments: GeneratedComment[];
  campaignId: string;
  campaignPostId: string;
  accountId: string;
  platform: CampaignPlatform;
  postUrl: string;
  capacityParams: PlatformCapacityParams;
}) {
  const { comments, campaignId, campaignPostId, accountId, platform, postUrl, capacityParams } = params;

  const delayMin = capacityParams.delay_min_seconds ?? 30;
  const delayMax = Math.max(capacityParams.delay_max_seconds ?? 120, delayMin);

  let cumulativeDelay = 0;
  return comments.map((comment) => {
    cumulativeDelay += Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
    return {
      campaign_id: campaignId,
      campaign_post_id: campaignPostId,
      account_id: accountId,
      avatar_id: comment.avatarId,
      device_id: comment.deviceId,
      box_id: comment.boxId,
      platform,
      post_url: postUrl,
      comment_text: comment.commentText,
      status: "ready" as const,
      scheduled_at: new Date(Date.now() + cumulativeDelay * 1000).toISOString(),
      queued_at: new Date().toISOString(),
    };
  });
}

/**
 * Fetch the N most recent comments by an avatar (for anti-repetition).
 * Single source of truth — used by both processor and server actions.
 */
export async function getRecentAvatarComments(
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
