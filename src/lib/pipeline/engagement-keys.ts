/**
 * Single source of truth for the keys we write into
 * `campaign_posts.post_metrics` per platform.
 *
 * Both consumers — the network-graph engagement aggregator
 * (`actions/network.ts`) and the metric-chip renderer
 * (`components/automator/pipeline-post-row.tsx`) — import from here so
 * adding a new metric or a new platform stays a one-file change.
 *
 * The shape of `post_metrics` is set by `lib/pipeline/processor.ts`
 * (`fullPostToPipelinePost`); keep these arrays aligned with that
 * mapping.
 */

export const TWITTER_METRIC_KEYS = [
  "like_count",
  "view_count",
  "reply_count",
  "retweet_count",
  "quote_count",
] as const;

export const TIKTOK_METRIC_KEYS = [
  "play_count",
  "digg_count",
  "comment_count",
  "share_count",
  "collect_count",
] as const;

export type TwitterMetricKey = (typeof TWITTER_METRIC_KEYS)[number];
export type TiktokMetricKey = (typeof TIKTOK_METRIC_KEYS)[number];
export type EngagementMetricKey = TwitterMetricKey | TiktokMetricKey;

/**
 * Every engagement key Attila knows about, deduped. Order is stable so
 * sums and chip orderings are deterministic across renders.
 */
export const ENGAGEMENT_METRIC_KEYS: readonly EngagementMetricKey[] = [
  ...TWITTER_METRIC_KEYS,
  ...TIKTOK_METRIC_KEYS,
] as const;

/**
 * Sum every numeric engagement metric in a `post_metrics` jsonb blob.
 * Used by the network graph to size source-post nodes by total
 * engagement. Non-numeric / missing keys contribute 0.
 */
export function sumEngagementMetrics(
  metrics: Record<string, unknown> | null | undefined,
): number {
  if (!metrics) return 0;
  let total = 0;
  for (const key of ENGAGEMENT_METRIC_KEYS) {
    const v = metrics[key];
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  return total;
}
