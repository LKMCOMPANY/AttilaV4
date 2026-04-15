/**
 * Types for raw data returned by the Gorgone Supabase client.
 * These represent the shape of Gorgone's tables, not Attila's.
 */

export interface GorgoneClient {
  id: string;
  name: string;
  is_active: boolean;
}

export interface GorgoneZone {
  id: string;
  name: string;
  client_id: string;
  is_active: boolean;
  push_to_attila: boolean;
  data_sources: {
    twitter?: boolean;
    tiktok?: boolean;
    media?: boolean;
  };
}

export interface GorgoneRawTweetRow {
  id: string;
  zone_id: string;
  tweet_id: string;
  conversation_id: string | null;
  text: string;
  lang: string | null;
  twitter_created_at: string;
  collected_at: string;
  retweet_count: number;
  reply_count: number;
  like_count: number;
  quote_count: number;
  view_count: number;
  total_engagement: number;
  is_reply: boolean;
  in_reply_to_tweet_id: string | null;
  tweet_url: string | null;
  author: {
    username: string | null;
    name: string | null;
    followers_count: number;
    is_verified: boolean;
    is_blue_verified: boolean;
    profile_picture_url: string | null;
  } | null;
}

export interface GorgoneRawTiktokVideoRow {
  id: string;
  zone_id: string;
  video_id: string;
  description: string | null;
  language: string | null;
  tiktok_created_at: string;
  collected_at: string;
  play_count: number;
  digg_count: number;
  comment_count: number;
  share_count: number;
  collect_count: number;
  total_engagement: number;
  share_url: string | null;
  is_ad: boolean;
  author: {
    username: string | null;
    nickname: string | null;
    follower_count: number;
    is_verified: boolean;
    is_private: boolean;
    avatar_thumb: string | null;
  } | null;
}
