import { createGorgoneClient } from "./client";
import type {
  ZoneVolumeEstimate,
  TwitterBreakdown,
  TiktokBreakdown,
  EstimatorFilters,
  FilteredVolume,
  AvatarCapacityInput,
  CapacityEstimate,
} from "./types";

const PERIOD_HOURS = 24;

// ---------------------------------------------------------------------------
// 1. estimateZoneVolume — query Gorgone for raw volume stats
// ---------------------------------------------------------------------------

export async function estimateZoneVolume(
  zoneId: string,
  platform: "twitter" | "tiktok"
): Promise<ZoneVolumeEstimate> {
  return platform === "twitter"
    ? estimateTwitterVolume(zoneId)
    : estimateTiktokVolume(zoneId);
}

async function estimateTwitterVolume(
  zoneId: string
): Promise<ZoneVolumeEstimate> {
  const gorgone = createGorgoneClient();
  const since = await resolveWindowStart(gorgone, "twitter_tweets", zoneId);

  const baseFilter = {
    zone_id: zoneId,
    collected_gte: since,
  };

  const [total, replies, retweets, langRows, authorStats] = await Promise.all([
    countTweets(gorgone, baseFilter),
    countTweets(gorgone, { ...baseFilter, is_reply: true }),
    countRetweetsByText(gorgone, zoneId, since),
    tweetLanguages(gorgone, zoneId, since),
    tweetAuthorStats(gorgone, zoneId, since),
  ]);

  const originalPosts = total - replies - retweets;

  const breakdown: TwitterBreakdown = {
    platform: "twitter",
    original_posts: originalPosts,
    replies,
    retweets,
    pct_original: safePct(originalPosts, total),
    pct_replies: safePct(replies, total),
    pct_retweets: safePct(retweets, total),
    avg_engagement: authorStats.avg_engagement,
    avg_likes: authorStats.avg_likes,
    avg_views: authorStats.avg_views,
  };

  return {
    zone_id: zoneId,
    platform: "twitter",
    period_hours: PERIOD_HOURS,
    total_posts: total,
    avg_per_hour: round(total / PERIOD_HOURS),
    breakdown,
    by_language: langRows,
    author_stats: authorStats,
  };
}

async function estimateTiktokVolume(
  zoneId: string
): Promise<ZoneVolumeEstimate> {
  const gorgone = createGorgoneClient();
  const since = await resolveWindowStart(gorgone, "tiktok_videos", zoneId);

  const [total, ads, privateAuthors, langRows, authorStats] =
    await Promise.all([
      countTiktok(gorgone, zoneId, since),
      countTiktok(gorgone, zoneId, since, { is_ad: true }),
      countTiktokPrivateAuthors(gorgone, zoneId, since),
      tiktokLanguages(gorgone, zoneId, since),
      tiktokAuthorStats(gorgone, zoneId, since),
    ]);

  const breakdown: TiktokBreakdown = {
    platform: "tiktok",
    total_videos: total,
    pct_ads: safePct(ads, total),
    pct_private_authors: safePct(privateAuthors, total),
    avg_play_count: authorStats.avg_plays,
    avg_engagement: authorStats.avg_engagement,
    avg_comments: authorStats.avg_comments,
    avg_digg: authorStats.avg_digg,
  };

  return {
    zone_id: zoneId,
    platform: "tiktok",
    period_hours: PERIOD_HOURS,
    total_posts: total,
    avg_per_hour: round(total / PERIOD_HOURS),
    breakdown,
    by_language: langRows,
    author_stats: authorStats,
  };
}

// ---------------------------------------------------------------------------
// 2. applyFilters — pure calculation, no queries
// ---------------------------------------------------------------------------

export function applyFilters(
  volume: ZoneVolumeEstimate,
  filters: EstimatorFilters
): FilteredVolume {
  const applied: { name: string; pass_rate: number }[] = [];
  let rate = 1.0;

  if (volume.breakdown.platform === "twitter") {
    const b = volume.breakdown;

    if (filters.post_types && filters.post_types.length > 0) {
      let typePct = 0;
      if (filters.post_types.includes("post")) typePct += b.pct_original;
      if (filters.post_types.includes("reply")) typePct += b.pct_replies;
      if (filters.post_types.includes("retweet")) typePct += b.pct_retweets;
      const passRate = typePct / 100;
      applied.push({ name: "Post types", pass_rate: passRate });
      rate *= passRate;
    }
  }

  if (volume.breakdown.platform === "tiktok") {
    const b = volume.breakdown;

    if (filters.exclude_ads) {
      const passRate = 1 - b.pct_ads / 100;
      applied.push({ name: "Exclude ads", pass_rate: passRate });
      rate *= passRate;
    }

    if (filters.exclude_private) {
      const passRate = 1 - b.pct_private_authors / 100;
      applied.push({ name: "Exclude private", pass_rate: passRate });
      rate *= passRate;
    }
  }

  if (filters.verified_only) {
    const passRate = volume.author_stats.pct_verified / 100;
    applied.push({ name: "Verified only", pass_rate: passRate });
    rate *= passRate;
  }

  if (filters.min_author_followers != null) {
    let passRate: number;
    if (filters.min_author_followers >= 10000)
      passRate = volume.author_stats.pct_min_10000_followers / 100;
    else if (filters.min_author_followers >= 1000)
      passRate = volume.author_stats.pct_min_1000_followers / 100;
    else if (filters.min_author_followers >= 100)
      passRate = volume.author_stats.pct_min_100_followers / 100;
    else passRate = 1.0;

    applied.push({
      name: `Min ${filters.min_author_followers} followers`,
      pass_rate: passRate,
    });
    rate *= passRate;
  }

  if (filters.languages && filters.languages.length > 0) {
    const totalPosts = volume.total_posts || 1;
    const matchingPosts = filters.languages.reduce(
      (sum, lang) => sum + (volume.by_language[lang] ?? 0),
      0
    );
    const passRate = matchingPosts / totalPosts;
    applied.push({
      name: `Languages: ${filters.languages.join(", ")}`,
      pass_rate: passRate,
    });
    rate *= passRate;
  }

  const rawPerHour = volume.avg_per_hour;
  const filteredPerHour = round(rawPerHour * rate);

  return {
    raw_per_hour: rawPerHour,
    filtered_per_hour: filteredPerHour,
    filter_pass_rate: round(rate, 4),
    filters_applied: applied,
  };
}

// ---------------------------------------------------------------------------
// 3. estimateCapacity — pure calculation
// ---------------------------------------------------------------------------

export function estimateCapacity(
  filtered: FilteredVolume,
  params: AvatarCapacityInput
): CapacityEstimate {
  const avgAvatarsPerPost =
    (params.min_avatars_per_post + params.max_avatars_per_post) / 2;

  const responsesPerHour = filtered.filtered_per_hour * avgAvatarsPerPost;
  const responsesPerDay = responsesPerHour * 24;

  const availableAvatars = params.active_avatars;
  const blockedRate =
    params.total_avatars > 0
      ? round(1 - availableAvatars / params.total_avatars, 4)
      : 0;

  const capacityPerHour =
    availableAvatars * params.max_responses_per_avatar_per_hour;
  const capacityPerDay =
    availableAvatars * params.max_responses_per_avatar_per_day;

  const surplusPerHour = capacityPerHour - responsesPerHour;
  const surplusPerDay = capacityPerDay - responsesPerDay;

  const coverageRate =
    responsesPerHour > 0 ? round(capacityPerHour / responsesPerHour, 2) : 1;

  const avatarsNeededHourly =
    params.max_responses_per_avatar_per_hour > 0
      ? Math.ceil(responsesPerHour / params.max_responses_per_avatar_per_hour)
      : 0;

  const avatarsNeededDaily =
    params.max_responses_per_avatar_per_day > 0
      ? Math.ceil(responsesPerDay / params.max_responses_per_avatar_per_day)
      : 0;

  const avatarsNeeded = Math.max(avatarsNeededHourly, avatarsNeededDaily);
  const bottleneck: "hourly" | "daily" =
    avatarsNeededHourly >= avatarsNeededDaily ? "hourly" : "daily";

  const avatarsMissing = Math.max(0, avatarsNeeded - availableAvatars);

  return {
    avg_avatars_per_post: round(avgAvatarsPerPost, 1),
    responses_needed_per_hour: round(responsesPerHour),
    responses_needed_per_day: round(responsesPerDay),
    total_avatars: params.total_avatars,
    available_avatars: availableAvatars,
    blocked_rate: blockedRate,
    capacity_per_hour: capacityPerHour,
    capacity_per_day: capacityPerDay,
    surplus_per_hour: round(surplusPerHour),
    surplus_per_day: round(surplusPerDay),
    coverage_rate: coverageRate,
    avatars_needed_hourly: avatarsNeededHourly,
    avatars_needed_daily: avatarsNeededDaily,
    avatars_needed: avatarsNeeded,
    avatars_missing: avatarsMissing,
    bottleneck,
  };
}

// ---------------------------------------------------------------------------
// Internal: Twitter query helpers
// ---------------------------------------------------------------------------

type GorgoneSupabase = ReturnType<typeof createGorgoneClient>;

interface TweetFilter {
  zone_id: string;
  collected_gte: string;
  is_reply?: boolean;
}

async function countTweets(
  gorgone: GorgoneSupabase,
  filter: TweetFilter
): Promise<number> {
  let query = gorgone
    .from("twitter_tweets")
    .select("*", { count: "exact", head: true })
    .eq("zone_id", filter.zone_id)
    .gte("collected_at", filter.collected_gte);

  if (filter.is_reply !== undefined) {
    query = query.eq("is_reply", filter.is_reply);
  }

  const { count } = await query;
  return count ?? 0;
}

async function countRetweetsByText(
  gorgone: GorgoneSupabase,
  zoneId: string,
  since: string
): Promise<number> {
  const { count } = await gorgone
    .from("twitter_tweets")
    .select("*", { count: "exact", head: true })
    .eq("zone_id", zoneId)
    .gte("collected_at", since)
    .like("text", "RT @%");

  return count ?? 0;
}

async function tweetLanguages(
  gorgone: GorgoneSupabase,
  zoneId: string,
  since: string
): Promise<Record<string, number>> {
  const { data } = await gorgone
    .from("twitter_tweets")
    .select("lang")
    .eq("zone_id", zoneId)
    .gte("collected_at", since);

  if (!data) return {};

  const counts: Record<string, number> = {};
  for (const row of data as { lang: string | null }[]) {
    const lang = row.lang ?? "unknown";
    counts[lang] = (counts[lang] ?? 0) + 1;
  }
  return counts;
}

async function tweetAuthorStats(
  gorgone: GorgoneSupabase,
  zoneId: string,
  since: string
): Promise<
  ZoneVolumeEstimate["author_stats"] & {
    avg_engagement: number;
    avg_likes: number;
    avg_views: number;
  }
> {
  const { data: tweets } = await gorgone
    .from("twitter_tweets")
    .select(
      `total_engagement, like_count, view_count,
       author:twitter_profiles!author_profile_id(followers_count, is_verified, is_blue_verified)`
    )
    .eq("zone_id", zoneId)
    .gte("collected_at", since)
    .limit(5000);

  if (!tweets || tweets.length === 0) {
    return {
      pct_verified: 0,
      pct_min_100_followers: 0,
      pct_min_1000_followers: 0,
      pct_min_10000_followers: 0,
      avg_engagement: 0,
      avg_likes: 0,
      avg_views: 0,
    };
  }

  type TweetRow = {
    total_engagement: number;
    like_count: number;
    view_count: number;
    author: {
      followers_count: number;
      is_verified: boolean;
      is_blue_verified: boolean;
    } | null;
  };

  const rows = tweets as unknown as TweetRow[];
  const total = rows.length;

  let verified = 0,
    f100 = 0,
    f1000 = 0,
    f10000 = 0;
  let sumEngagement = 0,
    sumLikes = 0,
    sumViews = 0;

  for (const t of rows) {
    sumEngagement += t.total_engagement ?? 0;
    sumLikes += t.like_count ?? 0;
    sumViews += t.view_count ?? 0;

    if (t.author) {
      if (t.author.is_verified || t.author.is_blue_verified) verified++;
      if (t.author.followers_count >= 100) f100++;
      if (t.author.followers_count >= 1000) f1000++;
      if (t.author.followers_count >= 10000) f10000++;
    }
  }

  return {
    pct_verified: safePct(verified, total),
    pct_min_100_followers: safePct(f100, total),
    pct_min_1000_followers: safePct(f1000, total),
    pct_min_10000_followers: safePct(f10000, total),
    avg_engagement: round(sumEngagement / total),
    avg_likes: round(sumLikes / total),
    avg_views: round(sumViews / total),
  };
}

// ---------------------------------------------------------------------------
// Internal: TikTok query helpers
// ---------------------------------------------------------------------------

async function countTiktok(
  gorgone: GorgoneSupabase,
  zoneId: string,
  since: string,
  extra?: { is_ad?: boolean }
): Promise<number> {
  let query = gorgone
    .from("tiktok_videos")
    .select("*", { count: "exact", head: true })
    .eq("zone_id", zoneId)
    .gte("collected_at", since);

  if (extra?.is_ad !== undefined) {
    query = query.eq("is_ad", extra.is_ad);
  }

  const { count } = await query;
  return count ?? 0;
}

async function countTiktokPrivateAuthors(
  gorgone: GorgoneSupabase,
  zoneId: string,
  since: string
): Promise<number> {
  const { data } = await gorgone
    .from("tiktok_videos")
    .select(
      "author:tiktok_profiles!author_profile_id(is_private)"
    )
    .eq("zone_id", zoneId)
    .gte("collected_at", since)
    .limit(5000);

  if (!data) return 0;

  type Row = { author: { is_private: boolean } | null };
  return (data as unknown as Row[]).filter((r) => r.author?.is_private).length;
}

async function tiktokLanguages(
  gorgone: GorgoneSupabase,
  zoneId: string,
  since: string
): Promise<Record<string, number>> {
  const { data } = await gorgone
    .from("tiktok_videos")
    .select("language")
    .eq("zone_id", zoneId)
    .gte("collected_at", since);

  if (!data) return {};

  const counts: Record<string, number> = {};
  for (const row of data as { language: string | null }[]) {
    const lang = row.language ?? "unknown";
    counts[lang] = (counts[lang] ?? 0) + 1;
  }
  return counts;
}

async function tiktokAuthorStats(
  gorgone: GorgoneSupabase,
  zoneId: string,
  since: string
): Promise<
  ZoneVolumeEstimate["author_stats"] & {
    avg_plays: number;
    avg_engagement: number;
    avg_comments: number;
    avg_digg: number;
  }
> {
  const { data: videos } = await gorgone
    .from("tiktok_videos")
    .select(
      `play_count, total_engagement, comment_count, digg_count,
       author:tiktok_profiles!author_profile_id(follower_count, is_verified)`
    )
    .eq("zone_id", zoneId)
    .gte("collected_at", since)
    .limit(5000);

  if (!videos || videos.length === 0) {
    return {
      pct_verified: 0,
      pct_min_100_followers: 0,
      pct_min_1000_followers: 0,
      pct_min_10000_followers: 0,
      avg_plays: 0,
      avg_engagement: 0,
      avg_comments: 0,
      avg_digg: 0,
    };
  }

  type VideoRow = {
    play_count: number;
    total_engagement: number;
    comment_count: number;
    digg_count: number;
    author: { follower_count: number; is_verified: boolean } | null;
  };

  const rows = videos as unknown as VideoRow[];
  const total = rows.length;

  let verified = 0,
    f100 = 0,
    f1000 = 0,
    f10000 = 0;
  let sumPlays = 0,
    sumEngagement = 0,
    sumComments = 0,
    sumDigg = 0;

  for (const v of rows) {
    sumPlays += v.play_count ?? 0;
    sumEngagement += v.total_engagement ?? 0;
    sumComments += v.comment_count ?? 0;
    sumDigg += v.digg_count ?? 0;

    if (v.author) {
      if (v.author.is_verified) verified++;
      if (v.author.follower_count >= 100) f100++;
      if (v.author.follower_count >= 1000) f1000++;
      if (v.author.follower_count >= 10000) f10000++;
    }
  }

  return {
    pct_verified: safePct(verified, total),
    pct_min_100_followers: safePct(f100, total),
    pct_min_1000_followers: safePct(f1000, total),
    pct_min_10000_followers: safePct(f10000, total),
    avg_plays: round(sumPlays / total),
    avg_engagement: round(sumEngagement / total),
    avg_comments: round(sumComments / total),
    avg_digg: round(sumDigg / total),
  };
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

/**
 * Find the start of the 24h estimation window.
 * Uses the most recent collected_at for the zone rather than NOW(),
 * so zones whose collection has paused still return meaningful data.
 */
async function resolveWindowStart(
  gorgone: GorgoneSupabase,
  table: "twitter_tweets" | "tiktok_videos",
  zoneId: string
): Promise<string> {
  const { data } = await gorgone
    .from(table)
    .select("collected_at")
    .eq("zone_id", zoneId)
    .order("collected_at", { ascending: false })
    .limit(1)
    .single();

  if (!data?.collected_at) return hoursAgo(PERIOD_HOURS);

  const latestMs = new Date(data.collected_at as string).getTime();
  return new Date(latestMs - PERIOD_HOURS * 3600_000).toISOString();
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

function safePct(part: number, total: number): number {
  if (total === 0) return 0;
  return round((part / total) * 100, 1);
}

function round(n: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}
