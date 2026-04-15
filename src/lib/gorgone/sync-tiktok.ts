import type { SupabaseClient } from "@supabase/supabase-js";
import type { GorgoneRawTiktokVideoRow } from "./types";
import type { GorgoneSyncCursor } from "@/types";
import { executeCursorSync, type SyncResult } from "./sync-core";

const GORGONE_TIKTOK_SELECT = `
  id, zone_id, video_id, description, language,
  tiktok_created_at, collected_at,
  play_count, digg_count, comment_count, share_count, collect_count,
  total_engagement, share_url,
  author:tiktok_profiles!author_profile_id(
    username, nickname, follower_count, is_verified, avatar_thumb
  )
`.trim();

function mapTiktokRow(v: GorgoneRawTiktokVideoRow, accountId: string) {
  return {
    account_id: accountId,
    zone_id: v.zone_id,
    gorgone_id: v.id,
    video_id: v.video_id,
    description: v.description,
    language: v.language,
    tiktok_created_at: v.tiktok_created_at,
    collected_at: v.collected_at,
    play_count: v.play_count ?? 0,
    digg_count: v.digg_count ?? 0,
    comment_count: v.comment_count ?? 0,
    share_count: v.share_count ?? 0,
    collect_count: v.collect_count ?? 0,
    total_engagement: v.total_engagement ?? 0,
    share_url: v.share_url,
    author_username: v.author?.username ?? null,
    author_nickname: v.author?.nickname ?? null,
    author_followers: v.author?.follower_count ?? 0,
    author_verified: v.author?.is_verified ?? false,
    author_avatar: v.author?.avatar_thumb ?? null,
  };
}

export async function syncZoneTiktok(
  attila: SupabaseClient,
  cursor: GorgoneSyncCursor
): Promise<SyncResult> {
  return executeCursorSync<GorgoneRawTiktokVideoRow>({
    attila,
    cursor,
    gorgoneTable: "tiktok_videos",
    gorgoneSelect: GORGONE_TIKTOK_SELECT,
    attilaTable: "gorgone_tiktok_videos",
    mapRow: mapTiktokRow,
  });
}
