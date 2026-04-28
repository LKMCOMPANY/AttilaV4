import type {
  CampaignJobWithAvatar,
  CampaignPlatform,
  CampaignPost,
} from "@/types";

// ---------------------------------------------------------------------------
// Pure helpers for filtering / autocomplete in the automator panel.
// Kept framework-free so the same functions can be unit-tested in isolation
// and shared between PipelineActivity, PostDetailView, and PipelineToolbar.
// ---------------------------------------------------------------------------

const MAX_AUTHOR_SUGGESTIONS = 6;

export type PlatformFilter = CampaignPlatform | "all";

export interface PipelineFilters {
  query: string;
  platform: PlatformFilter;
}

export interface AuthorSuggestion {
  author: string;
  platform: CampaignPlatform;
  count: number;
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/^@/, "");
}

function postMatchesQuery(post: CampaignPost, q: string): boolean {
  if (!q) return true;
  const author = post.post_author?.toLowerCase() ?? "";
  if (author.includes(q)) return true;
  const text = post.post_text?.toLowerCase() ?? "";
  if (text.includes(q)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export function filterPosts(
  posts: CampaignPost[],
  { query, platform }: PipelineFilters,
): CampaignPost[] {
  const q = normalize(query);
  if (platform === "all" && !q) return posts;
  return posts.filter((post) => {
    if (platform !== "all" && post.platform !== platform) return false;
    return postMatchesQuery(post, q);
  });
}

/**
 * Filters jobs by the same criteria as posts. A job matches when its
 * platform/text/avatar matches, OR when its parent post matches — that way the
 * Queue / Activity tabs stay in sync with the active filter on Posts.
 */
export function filterJobs(
  jobs: CampaignJobWithAvatar[],
  { query, platform }: PipelineFilters,
  postsById: Map<string, CampaignPost>,
): CampaignJobWithAvatar[] {
  const q = normalize(query);
  if (platform === "all" && !q) return jobs;
  return jobs.filter((job) => {
    if (platform !== "all" && job.platform !== platform) return false;
    if (!q) return true;
    if (job.comment_text?.toLowerCase().includes(q)) return true;
    if (job.avatar_name?.toLowerCase().includes(q)) return true;
    const post = postsById.get(job.campaign_post_id);
    if (post && postMatchesQuery(post, q)) return true;
    return false;
  });
}

// ---------------------------------------------------------------------------
// Autocomplete — author suggestions
// ---------------------------------------------------------------------------

/**
 * Returns up to {@link MAX_AUTHOR_SUGGESTIONS} unique authors matching the
 * query, ordered by:
 *   1. authors whose handle starts with the query (prefix match)
 *   2. authors with the most posts in the dataset
 */
export function buildAuthorSuggestions(
  posts: CampaignPost[],
  query: string,
  platform: PlatformFilter,
): AuthorSuggestion[] {
  const q = normalize(query);
  if (!q) return [];

  const map = new Map<string, AuthorSuggestion>();
  for (const post of posts) {
    if (!post.post_author) continue;
    if (platform !== "all" && post.platform !== platform) continue;

    const handle = post.post_author;
    if (!handle.toLowerCase().includes(q)) continue;

    const key = `${post.platform}:${handle.toLowerCase()}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(key, {
        author: handle,
        platform: post.platform,
        count: 1,
      });
    }
  }

  return Array.from(map.values())
    .sort((a, b) => {
      const aPrefix = a.author.toLowerCase().startsWith(q) ? 0 : 1;
      const bPrefix = b.author.toLowerCase().startsWith(q) ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;
      return b.count - a.count;
    })
    .slice(0, MAX_AUTHOR_SUGGESTIONS);
}
