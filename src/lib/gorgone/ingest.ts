import type { SupabaseClient } from "@supabase/supabase-js";
import type { TweetPayloadData, TiktokPayloadData } from "./webhook-payload";

/**
 * Single source of truth for ingesting a Gorgone post into Attila.
 *
 * Both the webhook handler and the sweep reconciler call into these
 * functions, ensuring the database row is shaped identically regardless
 * of the delivery channel.
 *
 * Idempotency: `UNIQUE (gorgone_id)` + `ON CONFLICT DO NOTHING` ensures
 * duplicate deliveries (webhook retry, webhook + sweep race, manual
 * replay) never produce duplicate rows.
 *
 * After upsert, we call `register_gorgone_event` (Postgres RPC) to
 * advance the per-zone cursor and update activity counters atomically.
 */

export type IngestSource = "webhook" | "sweep";

export interface IngestOutcome {
  inserted: boolean;
  reason?: "no_link" | "duplicate" | "error";
  error?: string;
}

interface ResolvedAccount {
  account_id: string;
}

/**
 * Resolves the Attila account that owns a given Gorgone client.
 * Returns null if no active link exists — caller should treat as
 * "not for us" and silently drop the event.
 */
async function resolveAccountId(
  supabase: SupabaseClient,
  gorgoneClientId: string,
): Promise<ResolvedAccount | null> {
  const { data } = await supabase
    .from("gorgone_links")
    .select("account_id")
    .eq("gorgone_client_id", gorgoneClientId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return { account_id: data.account_id as string };
}

/**
 * Ingests a single tweet payload (from webhook OR sweep) into
 * `gorgone_tweets` with `status='pending'` so the pipeline picks it up.
 */
export async function ingestTweet(
  supabase: SupabaseClient,
  payload: TweetPayloadData,
  source: IngestSource,
): Promise<IngestOutcome> {
  const account = await resolveAccountId(supabase, payload.client_id);
  if (!account) return { inserted: false, reason: "no_link" };

  const row = {
    account_id: account.account_id,
    zone_id: payload.zone_id,
    gorgone_id: payload.gorgone_id,
    tweet_id: payload.tweet_id,
    conversation_id: payload.conversation_id,
    text: payload.text,
    lang: payload.lang,
    twitter_created_at: payload.twitter_created_at,
    collected_at: payload.collected_at,
    retweet_count: payload.retweet_count,
    reply_count: payload.reply_count,
    like_count: payload.like_count,
    quote_count: payload.quote_count,
    view_count: payload.view_count,
    total_engagement: payload.total_engagement,
    is_reply: payload.is_reply,
    in_reply_to_tweet_id: payload.in_reply_to_tweet_id,
    tweet_url: payload.tweet_url,
    author_username: payload.author_username,
    author_name: payload.author_name,
    author_followers: payload.author_followers,
    author_verified: payload.author_verified,
    author_profile_picture: payload.author_profile_picture,
  };

  const { data, error } = await supabase
    .from("gorgone_tweets")
    .upsert(row, { onConflict: "gorgone_id", ignoreDuplicates: true })
    .select("id");

  if (error) return { inserted: false, reason: "error", error: error.message };

  const inserted = (data?.length ?? 0) > 0;

  if (inserted) {
    await supabase.rpc("register_gorgone_event", {
      p_account_id: account.account_id,
      p_zone_id: payload.zone_id,
      p_zone_name: payload.zone_name,
      p_platform: "twitter",
      p_event_at: payload.collected_at,
      p_event_id: payload.gorgone_id,
      p_source: source,
    });
  }

  return inserted ? { inserted: true } : { inserted: false, reason: "duplicate" };
}

/**
 * Symmetric to `ingestTweet` for TikTok videos.
 */
export async function ingestTiktok(
  supabase: SupabaseClient,
  payload: TiktokPayloadData,
  source: IngestSource,
): Promise<IngestOutcome> {
  const account = await resolveAccountId(supabase, payload.client_id);
  if (!account) return { inserted: false, reason: "no_link" };

  const row = {
    account_id: account.account_id,
    zone_id: payload.zone_id,
    gorgone_id: payload.gorgone_id,
    video_id: payload.video_id,
    description: payload.description,
    language: payload.language,
    tiktok_created_at: payload.tiktok_created_at,
    collected_at: payload.collected_at,
    play_count: payload.play_count,
    digg_count: payload.digg_count,
    comment_count: payload.comment_count,
    share_count: payload.share_count,
    collect_count: payload.collect_count,
    total_engagement: payload.total_engagement,
    share_url: payload.share_url,
    is_ad: payload.is_ad,
    author_username: payload.author_username,
    author_nickname: payload.author_nickname,
    author_followers: payload.author_followers,
    author_verified: payload.author_verified,
    author_is_private: payload.author_is_private,
    author_avatar: payload.author_avatar,
  };

  const { data, error } = await supabase
    .from("gorgone_tiktok_videos")
    .upsert(row, { onConflict: "gorgone_id", ignoreDuplicates: true })
    .select("id");

  if (error) return { inserted: false, reason: "error", error: error.message };

  const inserted = (data?.length ?? 0) > 0;

  if (inserted) {
    await supabase.rpc("register_gorgone_event", {
      p_account_id: account.account_id,
      p_zone_id: payload.zone_id,
      p_zone_name: payload.zone_name,
      p_platform: "tiktok",
      p_event_at: payload.collected_at,
      p_event_id: payload.gorgone_id,
      p_source: source,
    });
  }

  return inserted ? { inserted: true } : { inserted: false, reason: "duplicate" };
}
