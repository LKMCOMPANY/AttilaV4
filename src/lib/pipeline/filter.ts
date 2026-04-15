import type { CampaignFilters } from "@/types";
import type { PipelinePost, FilterResult } from "./types";

/**
 * Apply rule-based campaign filters to a post.
 * Pure function — no DB, no LLM, no side effects.
 */
export function applyFilters(post: PipelinePost, filters: CampaignFilters): FilterResult {
  if (post.platform === "twitter") {
    return applyTwitterFilters(post, filters);
  }
  return applyTiktokFilters(post, filters);
}

function applyTwitterFilters(post: PipelinePost, f: CampaignFilters): FilterResult {
  if (f.post_types && f.post_types.length > 0 && post.post_type) {
    if (!f.post_types.includes(post.post_type)) {
      return { passed: false, reason: `post_type ${post.post_type} not in ${f.post_types.join(",")}` };
    }
  }

  const common = applyCommonFilters(post, f);
  if (!common.passed) return common;

  if (f.min_like_count != null) {
    const likes = (post.raw_metrics.like_count as number) ?? 0;
    if (likes < f.min_like_count) {
      return { passed: false, reason: `like_count ${likes} < ${f.min_like_count}` };
    }
  }

  if (f.min_view_count != null) {
    const views = (post.raw_metrics.view_count as number) ?? 0;
    if (views < f.min_view_count) {
      return { passed: false, reason: `view_count ${views} < ${f.min_view_count}` };
    }
  }

  if (f.min_reply_count != null) {
    const replies = (post.raw_metrics.reply_count as number) ?? 0;
    if (replies < f.min_reply_count) {
      return { passed: false, reason: `reply_count ${replies} < ${f.min_reply_count}` };
    }
  }

  if (f.min_quote_count != null) {
    const quotes = (post.raw_metrics.quote_count as number) ?? 0;
    if (quotes < f.min_quote_count) {
      return { passed: false, reason: `quote_count ${quotes} < ${f.min_quote_count}` };
    }
  }

  if (f.min_retweet_count != null) {
    const retweets = (post.raw_metrics.retweet_count as number) ?? 0;
    if (retweets < f.min_retweet_count) {
      return { passed: false, reason: `retweet_count ${retweets} < ${f.min_retweet_count}` };
    }
  }

  return { passed: true };
}

function applyTiktokFilters(post: PipelinePost, f: CampaignFilters): FilterResult {
  if (f.exclude_ads && post.is_ad) {
    return { passed: false, reason: "excluded: is_ad" };
  }

  if (f.exclude_private && post.author_is_private) {
    return { passed: false, reason: "excluded: author_is_private" };
  }

  const common = applyCommonFilters(post, f);
  if (!common.passed) return common;

  if (f.min_play_count != null) {
    const plays = (post.raw_metrics.play_count as number) ?? 0;
    if (plays < f.min_play_count) {
      return { passed: false, reason: `play_count ${plays} < ${f.min_play_count}` };
    }
  }

  if (f.min_comment_count != null) {
    const comments = (post.raw_metrics.comment_count as number) ?? 0;
    if (comments < f.min_comment_count) {
      return { passed: false, reason: `comment_count ${comments} < ${f.min_comment_count}` };
    }
  }

  if (f.min_digg_count != null) {
    const diggs = (post.raw_metrics.digg_count as number) ?? 0;
    if (diggs < f.min_digg_count) {
      return { passed: false, reason: `digg_count ${diggs} < ${f.min_digg_count}` };
    }
  }

  if (f.min_share_count != null) {
    const shares = (post.raw_metrics.share_count as number) ?? 0;
    if (shares < f.min_share_count) {
      return { passed: false, reason: `share_count ${shares} < ${f.min_share_count}` };
    }
  }

  if (f.min_collect_count != null) {
    const collects = (post.raw_metrics.collect_count as number) ?? 0;
    if (collects < f.min_collect_count) {
      return { passed: false, reason: `collect_count ${collects} < ${f.min_collect_count}` };
    }
  }

  return { passed: true };
}

function applyCommonFilters(post: PipelinePost, f: CampaignFilters): FilterResult {
  if (f.min_author_followers != null && post.author_followers < f.min_author_followers) {
    return { passed: false, reason: `author_followers ${post.author_followers} < ${f.min_author_followers}` };
  }

  if (f.verified_only && !post.author_verified) {
    return { passed: false, reason: "verified_only: not verified" };
  }

  if (f.languages && f.languages.length > 0 && post.language) {
    if (!f.languages.includes(post.language)) {
      return { passed: false, reason: `language ${post.language} not in ${f.languages.join(",")}` };
    }
  }

  if (f.min_engagement != null && post.total_engagement < f.min_engagement) {
    return { passed: false, reason: `total_engagement ${post.total_engagement} < ${f.min_engagement}` };
  }

  return { passed: true };
}
