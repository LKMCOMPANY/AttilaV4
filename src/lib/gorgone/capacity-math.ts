import type { CampaignFilters } from "@/types";
import { applyFilters } from "@/lib/pipeline/filter";
import type { FilterablePost } from "@/lib/pipeline/types";
import type {
  ZoneVolumeEstimate,
  FilteredVolume,
  AppliedFilterRate,
  AvatarCapacityInput,
  CapacityEstimate,
  TwitterBreakdown,
  TiktokBreakdown,
} from "./types";
import type { SampleRow } from "./capacity-queries";

/**
 * Pure-function math for the capacity estimator. No I/O.
 *
 * Filter rates are measured empirically: each sampled Gorgone row is
 * mapped to the pipeline's `FilterablePost` shape and evaluated with the
 * SAME `applyFilters` the runtime pipeline uses. This guarantees the
 * estimate and the live behaviour can't drift apart (the previous
 * implementation re-modelled a subset of the filters statistically and
 * ignored the rest, overstating "Filtered / h").
 */

// ---------------------------------------------------------------------------
// Sample row → FilterablePost
// ---------------------------------------------------------------------------

export function sampleRowToFilterable(
  row: SampleRow,
  platform: "twitter" | "tiktok",
): FilterablePost {
  const likes = row.likes ?? 0;
  const retweets = row.retweets ?? 0;
  const replies = row.replies ?? 0;
  const quotes = row.quotes ?? 0;
  const views = row.views ?? 0;
  const bookmarks = row.bookmarks ?? 0;

  // Mirrors `fullPostToPipelinePost` in lib/pipeline/processor.ts.
  const rawMetrics: Record<string, unknown> =
    platform === "twitter"
      ? {
          like_count: likes,
          retweet_count: retweets,
          reply_count: replies,
          quote_count: quotes,
          view_count: views,
        }
      : {
          play_count: views,
          digg_count: likes,
          comment_count: replies,
          share_count: retweets,
          collect_count: bookmarks,
        };

  return {
    platform,
    author_followers: row.author?.followers_count ?? 0,
    author_verified: deriveVerified(row, platform),
    total_engagement: likes + retweets + replies + quotes,
    language: row.lang,
    is_ad: Boolean(row.tiktok_post_extras?.[0]?.is_ads),
    author_is_private: Boolean(row.author?.protected),
    post_type: deriveKind(row.kind),
    raw_metrics: rawMetrics,
  };
}

function deriveKind(kind: string | null): "post" | "reply" | "retweet" {
  if (kind === "reply" || kind === "comment") return "reply";
  if (kind === "repost") return "retweet";
  return "post";
}

function deriveVerified(row: SampleRow, platform: "twitter" | "tiktok"): boolean {
  if (platform === "twitter") {
    const x = row.author?.twitter_social_user_extras?.[0];
    return Boolean(x?.blue_verified) || Boolean(x?.legacy_verified);
  }
  return Boolean(row.author?.tiktok_social_user_extras?.[0]?.verified);
}

// ---------------------------------------------------------------------------
// Filter simulation — joint pass rate + per-filter breakdown
// ---------------------------------------------------------------------------

/**
 * Active-filter descriptors: which keys are set + a display label +
 * which platform's block they belong to (a TikTok-only filter must not
 * appear — even at 100% — under the Twitter card).
 */
type FilterPlatform = "twitter" | "tiktok" | "common";

const FILTER_DESCRIPTORS: {
  key: keyof CampaignFilters;
  platform: FilterPlatform;
  isActive: (f: CampaignFilters) => boolean;
  label: (f: CampaignFilters) => string;
}[] = [
  { key: "post_types", platform: "twitter", isActive: (f) => (f.post_types?.length ?? 0) > 0, label: (f) => `Post types: ${f.post_types!.join(", ")}` },
  { key: "tiktok_content_kinds", platform: "tiktok", isActive: (f) => (f.tiktok_content_kinds?.length ?? 0) > 0, label: (f) => `Content: ${f.tiktok_content_kinds!.join(", ")}s` },
  { key: "exclude_ads", platform: "tiktok", isActive: (f) => f.exclude_ads === true, label: () => "Exclude ads" },
  { key: "exclude_private", platform: "tiktok", isActive: (f) => f.exclude_private === true, label: () => "Exclude private authors" },
  { key: "verified_only", platform: "common", isActive: (f) => f.verified_only === true, label: () => "Verified authors only" },
  { key: "min_author_followers", platform: "common", isActive: (f) => f.min_author_followers != null, label: (f) => `Min ${f.min_author_followers} followers` },
  { key: "languages", platform: "common", isActive: (f) => (f.languages?.length ?? 0) > 0, label: (f) => `Languages: ${f.languages!.join(", ")}` },
  { key: "min_engagement", platform: "common", isActive: (f) => f.min_engagement != null, label: (f) => `Min engagement ${f.min_engagement}` },
  { key: "min_like_count", platform: "twitter", isActive: (f) => f.min_like_count != null, label: (f) => `Min ${f.min_like_count} likes` },
  { key: "min_view_count", platform: "twitter", isActive: (f) => f.min_view_count != null, label: (f) => `Min ${f.min_view_count} views` },
  { key: "min_reply_count", platform: "twitter", isActive: (f) => f.min_reply_count != null, label: (f) => `Min ${f.min_reply_count} replies` },
  { key: "min_quote_count", platform: "twitter", isActive: (f) => f.min_quote_count != null, label: (f) => `Min ${f.min_quote_count} quotes` },
  { key: "min_retweet_count", platform: "twitter", isActive: (f) => f.min_retweet_count != null, label: (f) => `Min ${f.min_retweet_count} retweets` },
  { key: "min_play_count", platform: "tiktok", isActive: (f) => f.min_play_count != null, label: (f) => `Min ${f.min_play_count} plays` },
  { key: "min_comment_count", platform: "tiktok", isActive: (f) => f.min_comment_count != null, label: (f) => `Min ${f.min_comment_count} comments` },
  { key: "min_digg_count", platform: "tiktok", isActive: (f) => f.min_digg_count != null, label: (f) => `Min ${f.min_digg_count} likes (diggs)` },
  { key: "min_share_count", platform: "tiktok", isActive: (f) => f.min_share_count != null, label: (f) => `Min ${f.min_share_count} shares` },
  { key: "min_collect_count", platform: "tiktok", isActive: (f) => f.min_collect_count != null, label: (f) => `Min ${f.min_collect_count} saves` },
];

/**
 * Measure filter impact on the sampled posts.
 *
 *   - `filter_pass_rate`  — fraction passing ALL filters together (what
 *     the pipeline will actually let through).
 *   - `filters_applied`   — pass rate of each active filter in isolation
 *     (diagnostic: which filter costs the most volume).
 *
 * With an empty sample there is nothing to measure — rates default to 1
 * so `filtered = raw` (raw is 0 anyway when the zone is silent).
 */
export function computeFilteredVolume(
  volume: ZoneVolumeEstimate,
  sample: FilterablePost[],
  filters: CampaignFilters,
): FilteredVolume {
  const active = FILTER_DESCRIPTORS.filter(
    (d) =>
      d.isActive(filters) &&
      (d.platform === "common" || d.platform === volume.platform),
  );

  if (active.length === 0 || sample.length === 0) {
    return {
      raw_per_hour: volume.avg_per_hour,
      filtered_per_hour: volume.avg_per_hour,
      filter_pass_rate: 1,
      filters_applied: [],
    };
  }

  let jointPassed = 0;
  const soloFilters = active.map(
    (d) => ({ [d.key]: filters[d.key] }) as CampaignFilters,
  );
  const soloPassed = new Array<number>(active.length).fill(0);

  for (const post of sample) {
    if (applyFilters(post, filters).passed) jointPassed++;
    for (let i = 0; i < soloFilters.length; i++) {
      if (applyFilters(post, soloFilters[i]).passed) soloPassed[i]++;
    }
  }

  const jointRate = jointPassed / sample.length;
  const filtersApplied: AppliedFilterRate[] = active.map((d, i) => ({
    key: d.key,
    label: d.label(filters),
    pass_rate: round(soloPassed[i] / sample.length, 4),
  }));

  return {
    raw_per_hour: volume.avg_per_hour,
    filtered_per_hour: round(volume.avg_per_hour * jointRate),
    filter_pass_rate: round(jointRate, 4),
    filters_applied: filtersApplied,
  };
}

// ---------------------------------------------------------------------------
// Per-network breakdowns (exact kind counts + sample-based stats)
// ---------------------------------------------------------------------------

export function buildTwitterBreakdown(
  counts: { total: number; replies: number; retweets: number },
  sample: SampleRow[],
): TwitterBreakdown {
  const originals = Math.max(0, counts.total - counts.replies - counts.retweets);
  const n = sample.length;

  let verified = 0, sumEng = 0, sumLikes = 0, sumViews = 0;
  for (const r of sample) {
    if (deriveVerified(r, "twitter")) verified++;
    sumEng += (r.likes ?? 0) + (r.retweets ?? 0) + (r.replies ?? 0) + (r.quotes ?? 0);
    sumLikes += r.likes ?? 0;
    sumViews += r.views ?? 0;
  }

  return {
    platform: "twitter",
    original_posts: originals,
    replies: counts.replies,
    retweets: counts.retweets,
    pct_original: safePct(originals, counts.total),
    pct_replies: safePct(counts.replies, counts.total),
    pct_retweets: safePct(counts.retweets, counts.total),
    pct_verified_authors: safePct(verified, n),
    avg_engagement: n > 0 ? round(sumEng / n) : 0,
    avg_likes: n > 0 ? round(sumLikes / n) : 0,
    avg_views: n > 0 ? round(sumViews / n) : 0,
  };
}

export function buildTiktokBreakdown(
  counts: { total: number; comments: number },
  sample: SampleRow[],
): TiktokBreakdown {
  const videos = Math.max(0, counts.total - counts.comments);
  const n = sample.length;

  let ads = 0, priv = 0, verified = 0;
  // Play counts only exist on videos — averaging over comments (always 0)
  // would drag the number into meaninglessness.
  let videoRows = 0, sumPlays = 0, sumEng = 0;

  for (const r of sample) {
    if (r.tiktok_post_extras?.[0]?.is_ads) ads++;
    if (r.author?.protected) priv++;
    if (deriveVerified(r, "tiktok")) verified++;
    if (r.kind !== "comment") {
      videoRows++;
      sumPlays += r.views ?? 0;
      sumEng += (r.likes ?? 0) + (r.retweets ?? 0) + (r.replies ?? 0);
    }
  }

  return {
    platform: "tiktok",
    videos,
    comments: counts.comments,
    pct_videos: safePct(videos, counts.total),
    pct_comments: safePct(counts.comments, counts.total),
    pct_ads: safePct(ads, n),
    pct_private_authors: safePct(priv, n),
    pct_verified_authors: safePct(verified, n),
    avg_play_count: videoRows > 0 ? round(sumPlays / videoRows) : 0,
    avg_engagement: videoRows > 0 ? round(sumEng / videoRows) : 0,
  };
}

/** Language histogram over the sample. */
export function buildLanguageHistogram(sample: SampleRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of sample) {
    const lang = r.lang ?? "unknown";
    counts[lang] = (counts[lang] ?? 0) + 1;
  }
  return counts;
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
  const capacityPerHour =
    availableAvatars * params.max_responses_per_avatar_per_hour;
  const capacityPerDay =
    availableAvatars * params.max_responses_per_avatar_per_day;

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
    capacity_per_hour: capacityPerHour,
    capacity_per_day: capacityPerDay,
    avatars_needed: avatarsNeeded,
    avatars_missing: avatarsMissing,
    bottleneck,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safePct(part: number, total: number): number {
  if (total === 0) return 0;
  return round((part / total) * 100, 1);
}

export function round(n: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}
