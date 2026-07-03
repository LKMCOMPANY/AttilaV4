import { createGorgoneClient } from "./client";
import type { GorgoneNetwork } from "@/types";
import type { GorgonePostKind } from "./webhook-payload";
import { embedOne, type EmbedOne } from "./postgrest";

/**
 * Re-fetch the full payload of a Gorgone post when Attila's pipeline is
 * about to process it.
 *
 * Why on-demand instead of caching the payload in Attila:
 *   - Single source of truth: Gorgone owns the content. If a post is edited
 *     (Twitter's 5-edits-within-30-min window) or deleted upstream, the
 *     pipeline sees the same state Gorgone surfaces in its UI.
 *   - Free V4 bonuses: `post_ai_classifications` (sentiment) and
 *     `post_translations` are computed by Gorgone's worker; we get them at
 *     no extra cost in the same query and skip our own LLM analyst step
 *     when sentiment is high-confidence.
 *   - Storage: a 30-column shadow table in Attila per post is replaced by
 *     a 9-column ledger. ~75% saved on disk.
 *
 * Cost: 1 Supabase query per claimed post. Both projects live in
 * Frankfurt → ~3-5 ms intra-region. At 1500 posts/day that's negligible.
 */

export interface FullGorgonePost {
  id: string;
  posted_at: string;
  account_id: string;
  zone_id: string;
  network: GorgoneNetwork;
  network_id: string;
  kind: GorgonePostKind;
  text: string;
  lang: string | null;
  posted_at_iso: string;
  first_seen_at: string;

  // Engagement (common across networks)
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  views: number;
  bookmarks: number;
  total_engagement: number;

  // Author (denormalised from social_users + per-network extras)
  author_handle: string | null;
  author_name: string | null;
  author_followers: number;
  author_verified: boolean;
  author_is_private: boolean;
  author_avatar: string | null;

  // Reconstructed share URL
  post_url: string | null;

  // Best-available still image for the vision model: TikTok photo-carousel
  // image, else TikTok video cover, else first Twitter media. Signed CDN
  // URLs — they expire a few hours after collection, so consumers must
  // degrade gracefully when the fetch fails.
  image_url: string | null;

  // Network-specific flags surfaced for filters (rest stays in Gorgone)
  is_reply: boolean;
  is_repost: boolean;
  is_ad: boolean;

  // V4 bonuses — may be null when AI hasn't processed yet
  sentiment_label: string | null;
  sentiment_score: number | null;
  translation_text: string | null;
  translation_lang: string | null;
}

interface RawPostRow {
  id: string;
  posted_at: string;
  account_id: string;
  zone_id: string;
  network: GorgoneNetwork;
  network_id: string;
  kind: GorgonePostKind | null;
  text: string;
  lang: string | null;
  first_seen_at: string;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  quotes: number | null;
  views: number | null;
  bookmarks: number | null;
  author: RawSocialUser | null;
  // 1:1 extras (only the network we care about will be non-null).
  // PostgREST returns to-one embeds as OBJECTS — normalized via embedOne.
  twitter_post_extras: EmbedOne<{ source_url: string | null }>;
  tiktok_post_extras: EmbedOne<{
    share_url: string | null;
    is_ads: boolean | null;
  }>;
  // AI sidecars (true to-many relations — real arrays)
  post_ai_classifications:
    | { label: string; score: number }[]
    | null;
  post_translations:
    | { text_translated: string; target_lang: string }[]
    | null;
  // Narrow JSON-path picks from `raw` (never the full blob — TikTok payloads
  // are tens of KB). PostgREST `->` drill-down keeps the wire cost to ~200 B.
  tiktok_photo_url: string | null;
  tiktok_cover_url: string | null;
  twitter_media_url: string | null;
}

interface RawSocialUser {
  id: string;
  handle: string | null;
  display_name: string | null;
  followers_count: number | null;
  protected: boolean | null;
  avatar_url: string | null;
  twitter_social_user_extras: EmbedOne<{
    blue_verified: boolean | null;
    legacy_verified: boolean | null;
  }>;
  tiktok_social_user_extras: EmbedOne<{ verified: boolean | null }>;
}

const SELECT_CLAUSE = `
  id, posted_at, account_id, zone_id, network, network_id, kind, text, lang,
  first_seen_at, likes, retweets, replies, quotes, views, bookmarks,
  author:social_users!author_social_user_id (
    id, handle, display_name, followers_count, protected, avatar_url,
    twitter_social_user_extras (blue_verified, legacy_verified),
    tiktok_social_user_extras (verified)
  ),
  twitter_post_extras (source_url),
  tiktok_post_extras (share_url, is_ads),
  post_ai_classifications (label, score),
  post_translations (text_translated, target_lang),
  tiktok_photo_url:raw->image_post_info->images->0->display_image->url_list->>0,
  tiktok_cover_url:raw->video->cover->url_list->>0,
  twitter_media_url:raw->entities->media->0->>media_url_https
`.trim();

/**
 * Fetch the full payload of a single post (composite PK lookup).
 * Returns null if the post was deleted upstream.
 */
export async function fetchFullGorgonePost(
  postId: string,
  postPostedAt: string,
): Promise<FullGorgonePost | null> {
  const gorgone = createGorgoneClient();
  const { data, error } = await gorgone
    .from("posts")
    .select(SELECT_CLAUSE)
    .eq("id", postId)
    .eq("posted_at", postPostedAt)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`fetchFullGorgonePost ${postId}: ${error.message}`);
  }
  if (!data) return null;

  return mapRawToFull(data as unknown as RawPostRow);
}

function mapRawToFull(row: RawPostRow): FullGorgonePost {
  const author = row.author;
  const twitterExtras = embedOne(row.twitter_post_extras);
  const tiktokExtras = embedOne(row.tiktok_post_extras);
  const sentiment = pickTopSentiment(row.post_ai_classifications);
  const translation = row.post_translations?.[0];

  const likes = row.likes ?? 0;
  const retweets = row.retweets ?? 0;
  const replies = row.replies ?? 0;
  const quotes = row.quotes ?? 0;
  const views = row.views ?? 0;
  const bookmarks = row.bookmarks ?? 0;

  return {
    id: row.id,
    posted_at: row.posted_at,
    posted_at_iso: row.posted_at,
    account_id: row.account_id,
    zone_id: row.zone_id,
    network: row.network,
    network_id: row.network_id,
    kind: row.kind ?? "post",
    text: row.text,
    lang: row.lang,
    first_seen_at: row.first_seen_at,
    likes,
    retweets,
    replies,
    quotes,
    views,
    bookmarks,
    total_engagement: likes + retweets + replies + quotes,
    author_handle: author?.handle ?? null,
    author_name: author?.display_name ?? null,
    author_followers: author?.followers_count ?? 0,
    author_verified: deriveVerified(row.network, author),
    author_is_private: Boolean(author?.protected),
    author_avatar: author?.avatar_url ?? null,
    post_url: buildPostUrl(row.network, author?.handle ?? null, row.network_id, twitterExtras?.source_url ?? null, tiktokExtras?.share_url ?? null),
    image_url: pickImageUrl(row),
    is_reply: row.kind === "reply" || row.kind === "comment",
    is_repost: row.kind === "repost",
    is_ad: Boolean(tiktokExtras?.is_ads),
    sentiment_label: sentiment?.label ?? null,
    sentiment_score: sentiment?.score ?? null,
    translation_text: translation?.text_translated ?? null,
    translation_lang: translation?.target_lang ?? null,
  };
}

function deriveVerified(network: GorgoneNetwork, author: RawSocialUser | null): boolean {
  if (!author) return false;
  if (network === "twitter") {
    const x = embedOne(author.twitter_social_user_extras);
    return Boolean(x?.blue_verified) || Boolean(x?.legacy_verified);
  }
  if (network === "tiktok") {
    return Boolean(embedOne(author.tiktok_social_user_extras)?.verified);
  }
  // Other networks: not surfaced today (no automation module yet).
  return false;
}

/**
 * Best still image for the vision analyst. Preference order:
 * TikTok photo-carousel image (the actual content) > TikTok video cover
 * (representative frame) > first Twitter media (photo or video thumb).
 * All are signed CDN URLs harvested by Gorgone at collection time — they
 * expire after a few hours, so a failed fetch downgrades to text-only.
 */
function pickImageUrl(row: RawPostRow): string | null {
  if (row.network === "tiktok") {
    return row.tiktok_photo_url ?? row.tiktok_cover_url ?? null;
  }
  if (row.network === "twitter") {
    return row.twitter_media_url ?? null;
  }
  return null;
}

function buildPostUrl(
  network: GorgoneNetwork,
  handle: string | null,
  networkId: string,
  twitterSourceUrl: string | null,
  tiktokShareUrl: string | null,
): string | null {
  if (network === "twitter") {
    // `twitter_post_extras.source_url` is the CLIENT the tweet was posted from
    // ("Twitter for iPhone", "mobile.twitter.com", "buffer.com"…), NOT a
    // permalink — Gorgone extracts it from the tweet's `source` anchor. Using
    // it as the deep-link target opens the X app home and the reply never
    // lands on the thread. Only trust it if it is actually a status permalink;
    // otherwise build the canonical URL from handle + id.
    if (twitterSourceUrl && /\/status\/\d+/.test(twitterSourceUrl)) return twitterSourceUrl;
    if (handle) return `https://twitter.com/${handle}/status/${networkId}`;
    return null;
  }
  if (network === "tiktok") {
    if (tiktokShareUrl) return tiktokShareUrl;
    if (handle) return `https://www.tiktok.com/@${handle}/video/${networkId}`;
    return null;
  }
  return null;
}

interface SentimentRow {
  label: string;
  score: number;
}

/**
 * Picks the sentiment classification with the highest score. Gorgone may
 * write multiple classifications per post (sentiment + topic + intent +
 * toxicity); we only care about the top sentiment for filter / analyst
 * short-circuiting.
 *
 * Returns null when no row carries an actual sentiment label — falling
 * back to an arbitrary classification (e.g. a topic label) used to
 * violate `campaign_posts_sentiment_label_check` at insert time and
 * lose the post.
 */
function pickTopSentiment(rows: SentimentRow[] | null): SentimentRow | null {
  if (!rows || rows.length === 0) return null;
  const sentimentLabels = new Set(["positive", "negative", "neutral"]);
  const sentimentRows = rows.filter((r) => sentimentLabels.has(r.label));
  if (sentimentRows.length === 0) return null;
  return [...sentimentRows].sort((a, b) => b.score - a.score)[0];
}
