/**
 * TikHub client — a SECONDARY, off-device signal for social verification and
 * campaign analytics. Never the primary success gate (the on-device UI-tree
 * check is), because a third-party scraper can miss a genuinely-posted item
 * (shadow-ban, region, comments not exposed). Its two jobs:
 *
 *   1. Twitter shadow-ban cross-check: after we post a reply on-device, we can
 *      confirm it from the avatar's OWN reply timeline (`fetch_user_tweet_replies`).
 *      The reply shows there even when it is hidden inside the target thread —
 *      the exact case a target-thread scrape would miss. Absence there while the
 *      on-device post succeeded is a strong shadow-ban / drop signal.
 *   2. TikTok comment cross-check: read the target video's comment list
 *      (`fetch_video_comments`) and match our text (preferring the avatar's
 *      handle). Absence while the on-device post succeeded flags a silent drop.
 *   3. Analytics: post-hoc metrics (likes, replies, views) for the dashboard.
 *
 * Everything here is best-effort and env-gated: with no `TIKHUB_API_KEY` the
 * helpers return `{ available: false }` and callers simply skip the cross-check.
 * The client never throws into the pipeline — failures degrade to "unknown".
 */

const BASE_URL = "https://api.tikhub.io";
const DEFAULT_TIMEOUT_MS = 15_000;

export function isTikHubEnabled(): boolean {
  return !!process.env.TIKHUB_API_KEY;
}

interface TikHubResponse<T> {
  code?: number;
  data?: T;
  message?: string;
}

/**
 * Low-level GET. Returns `null` on any transport/HTTP/parse failure or missing
 * key — never throws, so a verification call can't break a job.
 */
async function tikhubGet<T>(
  path: string,
  params: Record<string, string>,
): Promise<T | null> {
  const key = process.env.TIKHUB_API_KEY;
  if (!key) return null;

  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[TikHub] ${path} → HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as TikHubResponse<T>;
    if (json.code && json.code !== 200) {
      console.warn(`[TikHub] ${path} → code ${json.code}: ${json.message ?? ""}`);
      return null;
    }
    return (json.data ?? null) as T | null;
  } catch (err) {
    console.warn(`[TikHub] ${path} failed:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Twitter
// ---------------------------------------------------------------------------

export interface TweetMetrics {
  likes: number;
  replies: number;
  retweets: number;
  quotes: number;
  bookmarks: number;
  views: number;
}

interface RawTweet {
  tweet_id?: string;
  text?: string;
  in_reply_to_status_id_str?: string | null;
  likes?: number;
  replies?: number;
  retweets?: number;
  quotes?: number;
  bookmarks?: number;
  views?: number | string;
}

function toMetrics(t: RawTweet): TweetMetrics {
  return {
    likes: Number(t.likes ?? 0),
    replies: Number(t.replies ?? 0),
    retweets: Number(t.retweets ?? 0),
    quotes: Number(t.quotes ?? 0),
    bookmarks: Number(t.bookmarks ?? 0),
    views: Number(t.views ?? 0),
  };
}

export type ReplyVerification =
  | { available: false }
  | {
      available: true;
      /** The reply was found on the avatar's own reply timeline. */
      confirmed: boolean;
      /** How the match was made, when confirmed. */
      via?: "in_reply_to" | "text";
      tweetId?: string;
      metrics?: TweetMetrics;
    };

/** First ~40 normalized chars — enough to disambiguate a reply, tolerant of
 * trailing truncation / entity rewriting by the platform. */
function textKey(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 40).toLowerCase();
}

/**
 * Confirm an avatar actually posted a reply, from the avatar's OWN reply
 * timeline (shadow-ban-proof). Matches first on `in_reply_to_status_id_str`
 * (authoritative) then on reply text (fallback when the target id isn't echoed).
 */
export async function verifyTweetReply(params: {
  screenName: string;
  targetTweetId: string;
  text: string;
}): Promise<ReplyVerification> {
  if (!isTikHubEnabled()) return { available: false };

  const data = await tikhubGet<{ timeline?: RawTweet[] }>(
    "/api/v1/twitter/web/fetch_user_tweet_replies",
    { screen_name: params.screenName.replace(/^@/, "") },
  );
  // Null = transport/HTTP/parse failure (we could NOT check) — distinct from a
  // successful call that returned an empty/complete timeline (checked, absent).
  // Only the latter is a real "not confirmed" signal.
  if (!data) return { available: false };
  if (!Array.isArray(data.timeline)) return { available: true, confirmed: false };

  const wantText = textKey(params.text);
  for (const tweet of data.timeline) {
    const byTarget = tweet.in_reply_to_status_id_str === params.targetTweetId;
    const byText = !!tweet.text && textKey(tweet.text) === wantText;
    if (byTarget || byText) {
      return {
        available: true,
        confirmed: true,
        via: byTarget ? "in_reply_to" : "text",
        tweetId: tweet.tweet_id,
        metrics: toMetrics(tweet),
      };
    }
  }
  return { available: true, confirmed: false };
}

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------

interface RawTikTokComment {
  text?: string;
  cid?: string;
  user?: {
    unique_id?: string;
    nickname?: string;
    sec_uid?: string;
  };
}

export type CommentVerification =
  | { available: false }
  | {
      available: true;
      /** Our comment was found in the target video's comment list. */
      confirmed: boolean;
      /** How the match was made, when confirmed. */
      via?: "handle_text" | "text";
      commentId?: string;
    };

/**
 * Confirm an avatar actually posted a comment on a TikTok video, read from
 * the target video's OWN comment list (off-device, so it catches an on-device
 * "done" that TikTok silently dropped). Matches on our text — preferring the
 * row whose author handle is the avatar (authoritative), falling back to a
 * bare text match when the handle isn't echoed.
 *
 * IMPORTANT asymmetry vs Twitter: TikTok exposes no per-user comment history,
 * so we can only scan the TARGET video's comments — and TikHub returns them
 * sorted by "top"/relevance, not recency. On a busy video (thousands of
 * comments) a fresh avatar comment is buried far below what any sane
 * pagination reaches. So we ONLY return a terminal `confirmed:false`
 * ("unconfirmed") when we actually EXHAUST the comment list; if the list is
 * still longer than our page budget, we return `available:false` — an honest
 * "can't tell" rather than a false silent-drop verdict.
 */
// Each page is a paid TikHub call, and a comment we can't find in the first
// ~100 is almost certainly buried by the relevance sort (→ "can't tell", not a
// silent-drop verdict). Keep the budget tight: it still fully exhausts any
// video with ≤100 comments, which is exactly where a confirm/absent verdict is
// actually reachable.
const TIKTOK_COMMENT_PAGE = 50;
const TIKTOK_MAX_PAGES = 2;

export async function verifyTikTokComment(params: {
  awemeId: string;
  handle: string | null;
  text: string;
}): Promise<CommentVerification> {
  if (!isTikHubEnabled()) return { available: false };

  const wantText = textKey(params.text);
  const wantHandle = params.handle?.replace(/^@/, "").toLowerCase() ?? null;
  let cursor = 0;
  let reachedEnd = false;
  let textOnlyHit: string | undefined;

  for (let page = 0; page < TIKTOK_MAX_PAGES; page++) {
    const data = await tikhubGet<{ comments?: RawTikTokComment[]; has_more?: number | boolean; cursor?: number }>(
      "/api/v1/tiktok/app/v3/fetch_video_comments",
      { aweme_id: params.awemeId, count: String(TIKTOK_COMMENT_PAGE), cursor: String(cursor) },
    );
    if (!data) return { available: false };
    const comments = Array.isArray(data.comments) ? data.comments : [];

    for (const c of comments) {
      if (!c.text || textKey(c.text) !== wantText) continue;
      const handle = c.user?.unique_id?.toLowerCase();
      // Handle + text match is authoritative — it's definitely our avatar's row.
      if (wantHandle && handle === wantHandle) {
        return { available: true, confirmed: true, via: "handle_text", commentId: c.cid };
      }
      // Text match without a handle confirmation: remember as a fallback but
      // keep scanning for a stronger handle match first.
      textOnlyHit ??= c.cid ?? "";
    }

    if (!data.has_more || comments.length === 0) {
      reachedEnd = true;
      break;
    }
    cursor = typeof data.cursor === "number" ? data.cursor : cursor + comments.length;
  }

  if (textOnlyHit !== undefined) {
    return { available: true, confirmed: true, via: "text", commentId: textOnlyHit || undefined };
  }
  // Not found. Only a definitive "unconfirmed" if we saw the whole list;
  // otherwise it's buried below our budget → can't tell (leave unchecked).
  return reachedEnd ? { available: true, confirmed: false } : { available: false };
}

/** Post-hoc metrics for a tweet (campaign analytics). */
export async function getTweetMetrics(tweetId: string): Promise<TweetMetrics | null> {
  const data = await tikhubGet<RawTweet>("/api/v1/twitter/web/fetch_tweet_detail", {
    tweet_id: tweetId,
  });
  return data ? toMetrics(data) : null;
}

export interface TwitterProfile {
  status: string;
  followers: number;
  restId?: string;
}

/** Avatar account health — `status` flips to a non-"active" value when the
 * account is suspended/locked, a useful campaign-side alert. */
export async function getTwitterProfile(screenName: string): Promise<TwitterProfile | null> {
  const data = await tikhubGet<{ status?: string; friends?: number; sub_count?: number; rest_id?: string }>(
    "/api/v1/twitter/web/fetch_user_profile",
    { screen_name: screenName.replace(/^@/, "") },
  );
  if (!data) return null;
  return {
    status: data.status ?? "unknown",
    followers: Number(data.sub_count ?? 0),
    restId: data.rest_id,
  };
}
