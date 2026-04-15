import type { SupabaseClient } from "@supabase/supabase-js";
import type { GorgoneRawTweetRow } from "./types";
import type { GorgoneSyncCursor } from "@/types";
import { executeCursorSync, type SyncResult } from "./sync-core";

const GORGONE_TWEET_SELECT = `
  id, zone_id, tweet_id, conversation_id, text, lang,
  twitter_created_at, collected_at,
  retweet_count, reply_count, like_count, quote_count, view_count,
  total_engagement, is_reply, in_reply_to_tweet_id, tweet_url,
  author:twitter_profiles!author_profile_id(
    username, name, followers_count, is_verified, is_blue_verified, profile_picture_url
  )
`.trim();

function mapTweetRow(t: GorgoneRawTweetRow, accountId: string) {
  return {
    account_id: accountId,
    zone_id: t.zone_id,
    gorgone_id: t.id,
    tweet_id: t.tweet_id,
    conversation_id: t.conversation_id,
    text: t.text,
    lang: t.lang,
    twitter_created_at: t.twitter_created_at,
    collected_at: t.collected_at,
    retweet_count: t.retweet_count ?? 0,
    reply_count: t.reply_count ?? 0,
    like_count: t.like_count ?? 0,
    quote_count: t.quote_count ?? 0,
    view_count: t.view_count ?? 0,
    total_engagement: t.total_engagement ?? 0,
    is_reply: t.is_reply ?? false,
    in_reply_to_tweet_id: t.in_reply_to_tweet_id,
    tweet_url: t.tweet_url,
    author_username: t.author?.username ?? null,
    author_name: t.author?.name ?? null,
    author_followers: t.author?.followers_count ?? 0,
    author_verified: t.author?.is_verified || t.author?.is_blue_verified || false,
    author_profile_picture: t.author?.profile_picture_url ?? null,
  };
}

export async function syncZoneTweets(
  attila: SupabaseClient,
  cursor: GorgoneSyncCursor
): Promise<SyncResult> {
  return executeCursorSync<GorgoneRawTweetRow>({
    attila,
    cursor,
    gorgoneTable: "twitter_tweets",
    gorgoneSelect: GORGONE_TWEET_SELECT,
    attilaTable: "gorgone_tweets",
    mapRow: mapTweetRow,
  });
}
