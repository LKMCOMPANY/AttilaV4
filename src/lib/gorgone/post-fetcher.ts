import { createGorgoneClient } from "./client";
import type { GorgoneNetwork } from "@/types";
import type { GorgonePostKind } from "./webhook-payload";

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
  // 1:1 extras (only the network we care about will be non-null)
  twitter_post_extras: { source_url: string | null }[] | null;
  tiktok_post_extras: {
    share_url: string | null;
    is_ads: boolean | null;
  }[] | null;
  // AI sidecars (LIMIT 1 each via the Supabase select syntax)
  post_ai_classifications:
    | { label: string; score: number }[]
    | null;
  post_translations:
    | { text_translated: string; target_lang: string }[]
    | null;
}

interface RawSocialUser {
  id: string;
  handle: string | null;
  display_name: string | null;
  followers_count: number | null;
  protected: boolean | null;
  avatar_url: string | null;
  twitter_social_user_extras:
    | {
        blue_verified: boolean | null;
        legacy_verified: boolean | null;
      }[]
    | null;
  tiktok_social_user_extras:
    | { verified: boolean | null }[]
    | null;
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
  post_translations (text_translated, target_lang)
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
  const twitterExtras = row.twitter_post_extras?.[0];
  const tiktokExtras = row.tiktok_post_extras?.[0];
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
    const x = author.twitter_social_user_extras?.[0];
    return Boolean(x?.blue_verified) || Boolean(x?.legacy_verified);
  }
  if (network === "tiktok") {
    return Boolean(author.tiktok_social_user_extras?.[0]?.verified);
  }
  // Other networks: not surfaced today (no automation module yet).
  return false;
}

function buildPostUrl(
  network: GorgoneNetwork,
  handle: string | null,
  networkId: string,
  twitterSourceUrl: string | null,
  tiktokShareUrl: string | null,
): string | null {
  if (network === "twitter") {
    if (twitterSourceUrl) return twitterSourceUrl;
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
