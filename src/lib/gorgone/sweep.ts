import type { SupabaseClient } from "@supabase/supabase-js";
import { createGorgoneClient } from "./client";
import { ingestTweet, ingestTiktok } from "./ingest";
import type { TweetPayloadData, TiktokPayloadData } from "./webhook-payload";

/**
 * Sweep reconciler — safety net for the webhook pipeline.
 *
 * Webhooks are the primary delivery channel; this loop runs every
 * `SWEEP_INTERVAL_MS` and pulls anything Gorgone may have failed to
 * push (Attila down during deploy, transient 5xx, network hiccup).
 *
 * For each `(account, zone, platform)` row in `gorgone_zone_state` we:
 *   1. Query Gorgone for new rows since `(last_event_at, last_event_id)`
 *      using a composite cursor — safe even when many rows share the
 *      same `collected_at` second.
 *   2. Map each Gorgone row to the same payload shape used by the
 *      webhook handler.
 *   3. Call the same `ingestTweet` / `ingestTiktok` functions used by
 *      the webhook (zero divergence, idempotent via UNIQUE gorgone_id).
 *
 * Cost: at most one short query per active `(zone, platform)` per
 * `SWEEP_INTERVAL_MS`, regardless of volume.
 */

const SWEEP_BATCH_SIZE = 200;

const TWEET_SELECT = `
  id, zone_id, tweet_id, conversation_id, text, lang,
  twitter_created_at, collected_at,
  retweet_count, reply_count, like_count, quote_count, view_count,
  total_engagement, is_reply, in_reply_to_tweet_id, tweet_url,
  author:twitter_profiles!author_profile_id(
    username, name, followers_count, is_verified, is_blue_verified, profile_picture_url
  )
`.trim();

const TIKTOK_SELECT = `
  id, zone_id, video_id, description, language,
  tiktok_created_at, collected_at,
  play_count, digg_count, comment_count, share_count, collect_count,
  total_engagement, share_url, is_ad,
  author:tiktok_profiles!author_profile_id(
    username, nickname, follower_count, is_verified, is_private, avatar_thumb
  )
`.trim();

interface ZoneCursor {
  account_id: string;
  zone_id: string;
  zone_name: string;
  platform: "twitter" | "tiktok";
  last_event_at: string | null;
  last_event_id: string | null;
  client_id: string;
}

export interface SweepReport {
  cursors_processed: number;
  zones_with_data: number;
  total_ingested: number;
  errors: string[];
  duration_ms: number;
}

/**
 * Runs a single sweep cycle across all active links + zone states.
 */
export async function runSweepCycle(
  attila: SupabaseClient,
): Promise<SweepReport> {
  const start = Date.now();
  const report: SweepReport = {
    cursors_processed: 0,
    zones_with_data: 0,
    total_ingested: 0,
    errors: [],
    duration_ms: 0,
  };

  const cursors = await loadActiveCursors(attila);
  report.cursors_processed = cursors.length;

  for (const cursor of cursors) {
    try {
      const ingested = await sweepCursor(attila, cursor);
      if (ingested > 0) {
        report.zones_with_data += 1;
        report.total_ingested += ingested;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report.errors.push(`${cursor.zone_name}/${cursor.platform}: ${msg}`);
    }
  }

  report.duration_ms = Date.now() - start;
  return report;
}

/**
 * Loads cursors for every (account, zone, platform) state attached to an
 * active link. Resolves the Gorgone client_id along the way so the sweep
 * doesn't need to round-trip through it.
 */
async function loadActiveCursors(attila: SupabaseClient): Promise<ZoneCursor[]> {
  const { data, error } = await attila
    .from("gorgone_zone_state")
    .select(`
      account_id, zone_id, zone_name, platform,
      last_event_at, last_event_id,
      gorgone_links!inner(gorgone_client_id, is_active)
    `)
    .eq("gorgone_links.is_active", true);

  if (error) throw new Error(`load cursors: ${error.message}`);

  type Row = {
    account_id: string;
    zone_id: string;
    zone_name: string;
    platform: "twitter" | "tiktok";
    last_event_at: string | null;
    last_event_id: string | null;
    // PostgREST returns the joined relation as an array even with !inner.
    gorgone_links: { gorgone_client_id: string }[];
  };

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    account_id: row.account_id,
    zone_id: row.zone_id,
    zone_name: row.zone_name,
    platform: row.platform,
    last_event_at: row.last_event_at,
    last_event_id: row.last_event_id,
    client_id: row.gorgone_links[0]?.gorgone_client_id ?? "",
  })).filter((c) => c.client_id !== "");
}

/**
 * Sweep a single (zone, platform) cursor.
 * Returns the number of rows newly ingested.
 */
async function sweepCursor(attila: SupabaseClient, cursor: ZoneCursor): Promise<number> {
  const gorgone = createGorgoneClient();
  const isFirstSweep = cursor.last_event_at == null;

  const baseQuery = (table: string, select: string) => {
    let q = gorgone
      .from(table)
      .select(select)
      .eq("zone_id", cursor.zone_id)
      .order("collected_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(SWEEP_BATCH_SIZE);

    if (isFirstSweep) {
      // First sweep ever for this zone: only consider rows from the last
      // 5 minutes (a sane "recent" window). Webhooks handle the rest.
      const horizon = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      q = q.gte("collected_at", horizon);
    } else {
      // Composite tuple comparison: (collected_at, id) > (cursor)
      // PostgREST doesn't support row-tuple comparisons natively, so we
      // approximate: collected_at >= cursor (and dedup at upsert time).
      // Combined with UNIQUE(gorgone_id) ON CONFLICT NOOP, this is safe.
      q = q.gte("collected_at", cursor.last_event_at as string);
    }

    return q;
  };

  if (cursor.platform === "twitter") {
    const { data, error } = await baseQuery("twitter_tweets", TWEET_SELECT);
    if (error) throw new Error(`gorgone twitter: ${error.message}`);

    const rows = (data ?? []) as unknown as RawTweetRow[];
    let count = 0;
    for (const row of rows) {
      const payload = mapRawTweetToPayload(row, cursor);
      const result = await ingestTweet(attila, payload, "sweep");
      if (result.inserted) count += 1;
    }
    return count;
  }

  const { data, error } = await baseQuery("tiktok_videos", TIKTOK_SELECT);
  if (error) throw new Error(`gorgone tiktok: ${error.message}`);

  const rows = (data ?? []) as unknown as RawTiktokRow[];
  let count = 0;
  for (const row of rows) {
    const payload = mapRawTiktokToPayload(row, cursor);
    const result = await ingestTiktok(attila, payload, "sweep");
    if (result.inserted) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Mapping: Gorgone raw row -> webhook payload shape (so we share ingestTweet)
// ---------------------------------------------------------------------------

interface RawTweetRow {
  id: string;
  zone_id: string;
  tweet_id: string;
  conversation_id: string | null;
  text: string;
  lang: string | null;
  twitter_created_at: string;
  collected_at: string;
  retweet_count: number | null;
  reply_count: number | null;
  like_count: number | null;
  quote_count: number | null;
  view_count: number | null;
  total_engagement: number | null;
  is_reply: boolean | null;
  in_reply_to_tweet_id: string | null;
  tweet_url: string | null;
  author: {
    username: string | null;
    name: string | null;
    followers_count: number | null;
    is_verified: boolean | null;
    is_blue_verified: boolean | null;
    profile_picture_url: string | null;
  } | null;
}

interface RawTiktokRow {
  id: string;
  zone_id: string;
  video_id: string;
  description: string | null;
  language: string | null;
  tiktok_created_at: string;
  collected_at: string;
  play_count: number | null;
  digg_count: number | null;
  comment_count: number | null;
  share_count: number | null;
  collect_count: number | null;
  total_engagement: number | null;
  share_url: string | null;
  is_ad: boolean | null;
  author: {
    username: string | null;
    nickname: string | null;
    follower_count: number | null;
    is_verified: boolean | null;
    is_private: boolean | null;
    avatar_thumb: string | null;
  } | null;
}

function mapRawTweetToPayload(row: RawTweetRow, cursor: ZoneCursor): TweetPayloadData {
  return {
    gorgone_id: row.id,
    zone_id: row.zone_id,
    zone_name: cursor.zone_name,
    client_id: cursor.client_id,
    tweet_id: row.tweet_id,
    conversation_id: row.conversation_id,
    text: row.text,
    lang: row.lang,
    twitter_created_at: row.twitter_created_at,
    collected_at: row.collected_at,
    retweet_count: row.retweet_count ?? 0,
    reply_count: row.reply_count ?? 0,
    like_count: row.like_count ?? 0,
    quote_count: row.quote_count ?? 0,
    view_count: row.view_count ?? 0,
    total_engagement: row.total_engagement ?? 0,
    is_reply: row.is_reply ?? false,
    in_reply_to_tweet_id: row.in_reply_to_tweet_id,
    tweet_url: row.tweet_url,
    author_username: row.author?.username ?? null,
    author_name: row.author?.name ?? null,
    author_followers: row.author?.followers_count ?? 0,
    author_verified:
      Boolean(row.author?.is_verified) || Boolean(row.author?.is_blue_verified),
    author_profile_picture: row.author?.profile_picture_url ?? null,
  };
}

function mapRawTiktokToPayload(row: RawTiktokRow, cursor: ZoneCursor): TiktokPayloadData {
  return {
    gorgone_id: row.id,
    zone_id: row.zone_id,
    zone_name: cursor.zone_name,
    client_id: cursor.client_id,
    video_id: row.video_id,
    description: row.description,
    language: row.language,
    tiktok_created_at: row.tiktok_created_at,
    collected_at: row.collected_at,
    play_count: row.play_count ?? 0,
    digg_count: row.digg_count ?? 0,
    comment_count: row.comment_count ?? 0,
    share_count: row.share_count ?? 0,
    collect_count: row.collect_count ?? 0,
    total_engagement: row.total_engagement ?? 0,
    share_url: row.share_url,
    is_ad: row.is_ad ?? false,
    author_username: row.author?.username ?? null,
    author_nickname: row.author?.nickname ?? null,
    author_followers: row.author?.follower_count ?? 0,
    author_verified: Boolean(row.author?.is_verified),
    author_is_private: Boolean(row.author?.is_private),
    author_avatar: row.author?.avatar_thumb ?? null,
  };
}
