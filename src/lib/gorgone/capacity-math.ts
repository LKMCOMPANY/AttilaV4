import type {
  ZoneVolumeEstimate,
  EstimatorFilters,
  FilteredVolume,
  AvatarCapacityInput,
  CapacityEstimate,
} from "./types";
import type {
  RawTwitterAuthorRow,
  RawTiktokAuthorRow,
} from "./capacity-queries";

/**
 * Pure-function math for the capacity estimator. No I/O. Tested in
 * isolation. Consumed by the orchestrator in `capacity-estimator.ts`.
 */

// ---------------------------------------------------------------------------
// Filter pass-rate compounding
// ---------------------------------------------------------------------------

export function applyFilters(
  volume: ZoneVolumeEstimate,
  filters: EstimatorFilters,
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
    const passRate = followerThresholdPassRate(
      volume.author_stats,
      filters.min_author_followers,
    );
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
      0,
    );
    const passRate = matchingPosts / totalPosts;
    applied.push({
      name: `Languages: ${filters.languages.join(", ")}`,
      pass_rate: passRate,
    });
    rate *= passRate;
  }

  return {
    raw_per_hour: volume.avg_per_hour,
    filtered_per_hour: round(volume.avg_per_hour * rate),
    filter_pass_rate: round(rate, 4),
    filters_applied: applied,
  };
}

// ---------------------------------------------------------------------------
// Capacity calculation
// ---------------------------------------------------------------------------

export function estimateCapacity(
  filtered: FilteredVolume,
  params: AvatarCapacityInput,
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
// Per-network row reductions (sample → aggregate stats)
// ---------------------------------------------------------------------------

export interface TwitterAuthorAgg {
  pct_verified: number;
  pct_min_100_followers: number;
  pct_min_1000_followers: number;
  pct_min_10000_followers: number;
  avg_engagement: number;
  avg_likes: number;
  avg_views: number;
}

export interface TiktokAuthorAgg {
  pct_verified: number;
  pct_min_100_followers: number;
  pct_min_1000_followers: number;
  pct_min_10000_followers: number;
  avg_plays: number;
  avg_engagement: number;
  avg_comments: number;
  avg_digg: number;
}

export function reduceTwitterAuthors(
  rows: RawTwitterAuthorRow[],
): TwitterAuthorAgg {
  if (rows.length === 0) return EMPTY_TWITTER;
  const total = rows.length;
  let verified = 0,
    f100 = 0,
    f1000 = 0,
    f10000 = 0;
  let sumEngagement = 0,
    sumLikes = 0,
    sumViews = 0;

  for (const r of rows) {
    sumEngagement +=
      (r.likes ?? 0) + (r.retweets ?? 0) + (r.replies ?? 0) + (r.quotes ?? 0);
    sumLikes += r.likes ?? 0;
    sumViews += r.views ?? 0;

    const fc = r.author?.followers_count ?? 0;
    if (fc >= 100) f100++;
    if (fc >= 1000) f1000++;
    if (fc >= 10000) f10000++;

    const x = r.author?.twitter_social_user_extras?.[0];
    if (x?.blue_verified || x?.legacy_verified) verified++;
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

export function reduceTiktokAuthors(rows: RawTiktokAuthorRow[]): TiktokAuthorAgg {
  if (rows.length === 0) return EMPTY_TIKTOK;
  const total = rows.length;
  let verified = 0,
    f100 = 0,
    f1000 = 0,
    f10000 = 0;
  let sumPlays = 0,
    sumEngagement = 0,
    sumComments = 0,
    sumDigg = 0;

  for (const r of rows) {
    sumPlays += r.views ?? 0;
    sumComments += r.replies ?? 0;
    sumDigg += r.likes ?? 0;
    sumEngagement += (r.likes ?? 0) + (r.replies ?? 0) + (r.retweets ?? 0);

    const fc = r.author?.followers_count ?? 0;
    if (fc >= 100) f100++;
    if (fc >= 1000) f1000++;
    if (fc >= 10000) f10000++;

    if (r.author?.tiktok_social_user_extras?.[0]?.verified) verified++;
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
// Helpers
// ---------------------------------------------------------------------------

export function safePct(part: number, total: number): number {
  if (total === 0) return 0;
  return round((part / total) * 100, 1);
}

export function round(n: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

function followerThresholdPassRate(
  stats: ZoneVolumeEstimate["author_stats"],
  threshold: number,
): number {
  if (threshold >= 10_000) return stats.pct_min_10000_followers / 100;
  if (threshold >= 1_000) return stats.pct_min_1000_followers / 100;
  if (threshold >= 100) return stats.pct_min_100_followers / 100;
  return 1.0;
}

const EMPTY_TWITTER: TwitterAuthorAgg = {
  pct_verified: 0,
  pct_min_100_followers: 0,
  pct_min_1000_followers: 0,
  pct_min_10000_followers: 0,
  avg_engagement: 0,
  avg_likes: 0,
  avg_views: 0,
};

const EMPTY_TIKTOK: TiktokAuthorAgg = {
  pct_verified: 0,
  pct_min_100_followers: 0,
  pct_min_1000_followers: 0,
  pct_min_10000_followers: 0,
  avg_plays: 0,
  avg_engagement: 0,
  avg_comments: 0,
  avg_digg: 0,
};
