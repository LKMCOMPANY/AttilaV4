"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCampaignPosts,
  getCampaignJobs,
} from "@/app/actions/pipeline";
import type { CampaignJobWithAvatar, CampaignPost } from "@/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;
const FALLBACK_POLL_INTERVAL = 120_000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PipelineDataState {
  posts: CampaignPost[];
  jobs: CampaignJobWithAvatar[];
  loading: boolean;
  postsHasMore: boolean;
  jobsHasMore: boolean;
  postsLoadingMore: boolean;
  jobsLoadingMore: boolean;
  loadMorePosts: () => void;
  loadMoreJobs: () => void;
  /** Force-refetch the first page (newest items) and merge into local state. */
  refresh: () => Promise<void>;
}

interface UsePipelineDataParams {
  campaignId: string;
  pipelineVersion?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Merges a freshly fetched first-page (`latest`) into the locally held list
 * (`existing`):
 *   - existing rows are updated in place when they reappear in `latest`
 *     (so realtime status changes propagate without losing position),
 *   - rows in `latest` that aren't in `existing` are prepended (newest first).
 *
 * Order of `existing` is otherwise preserved, so older pages already loaded
 * via infinite scroll stay where they are.
 */
function mergeNewestById<T extends { id: string }>(
  latest: T[],
  existing: T[],
): T[] {
  if (existing.length === 0) return latest;
  if (latest.length === 0) return existing;

  const latestById = new Map(latest.map((row) => [row.id, row]));
  const existingIds = new Set(existing.map((row) => row.id));

  const updatedExisting = existing.map((row) => latestById.get(row.id) ?? row);
  const newRows = latest.filter((row) => !existingIds.has(row.id));

  return [...newRows, ...updatedExisting];
}

function dedupAppendById<T extends { id: string }>(
  existing: T[],
  next: T[],
): T[] {
  if (next.length === 0) return existing;
  const existingIds = new Set(existing.map((row) => row.id));
  const fresh = next.filter((row) => !existingIds.has(row.id));
  if (fresh.length === 0) return existing;
  return [...existing, ...fresh];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Owns the pipeline-activity dataset for a campaign:
 *   - first-page fetch on mount + on realtime ticks + on a 2-min fallback,
 *   - cursor-based "load more" for both posts and jobs,
 *   - merge-by-id so older pages stay loaded when realtime brings new rows.
 *
 * The two datasets are kept independent (posts vs jobs) so that scrolling
 * one tab doesn't trigger work for the other.
 */
export function usePipelineData({
  campaignId,
  pipelineVersion,
}: UsePipelineDataParams): PipelineDataState {
  const [posts, setPosts] = useState<CampaignPost[]>([]);
  const [jobs, setJobs] = useState<CampaignJobWithAvatar[]>([]);
  const [loading, setLoading] = useState(true);
  const [postsHasMore, setPostsHasMore] = useState(false);
  const [jobsHasMore, setJobsHasMore] = useState(false);
  const [postsLoadingMore, setPostsLoadingMore] = useState(false);
  const [jobsLoadingMore, setJobsLoadingMore] = useState(false);

  // `hasMore` is only set during initial load + load-more. Realtime refreshes
  // never overwrite it — we have no way to know without an extra round-trip
  // whether older data still exists, and the user-facing answer doesn't change
  // (the operator can keep scrolling until a short page proves we're done).
  const initialisedRef = useRef(false);

  // Per-call request id guards against stale-result races when realtime fires
  // multiple refreshes in quick succession — only the latest call commits to
  // state, earlier responses are dropped on arrival.
  const refreshRequestRef = useRef(0);

  // Reset whenever the campaign in view changes. The parent typically
  // remounts via `key={campaign.id}`, but this keeps the hook self-contained
  // for any caller that doesn't.
  useEffect(() => {
    initialisedRef.current = false;
    refreshRequestRef.current = 0;
    setPosts([]);
    setJobs([]);
    setPostsHasMore(false);
    setJobsHasMore(false);
    setPostsLoadingMore(false);
    setJobsLoadingMore(false);
    setLoading(true);
  }, [campaignId]);

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestRef.current;
    const [latestPosts, latestJobs] = await Promise.all([
      getCampaignPosts(campaignId, { limit: PAGE_SIZE }),
      getCampaignJobs(campaignId, { limit: PAGE_SIZE }),
    ]);
    // A newer refresh started while we were waiting — drop our results.
    if (requestId !== refreshRequestRef.current) return;
    setPosts((prev) => mergeNewestById(latestPosts, prev));
    setJobs((prev) => mergeNewestById(latestJobs, prev));
    if (!initialisedRef.current) {
      setPostsHasMore(latestPosts.length >= PAGE_SIZE);
      setJobsHasMore(latestJobs.length >= PAGE_SIZE);
      initialisedRef.current = true;
    }
    setLoading(false);
  }, [campaignId]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime-triggered refresh
  useEffect(() => {
    if (pipelineVersion && pipelineVersion > 0) refresh();
  }, [pipelineVersion, refresh]);

  // Long-interval fallback poll
  useEffect(() => {
    const interval = setInterval(refresh, FALLBACK_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [refresh]);

  // -------------------------------------------------------------------------
  // Cursor-based "load more"
  // -------------------------------------------------------------------------

  // We avoid putting the whole `posts`/`jobs` array in the dep list of the
  // load-more callbacks: the sentinel reads the current value once when it
  // fires, and re-installing the IntersectionObserver on every list update
  // would otherwise cause flicker.
  const postsRef = useRef(posts);
  const jobsRef = useRef(jobs);
  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const loadMorePosts = useCallback(async () => {
    if (postsLoadingMore || !postsHasMore) return;
    const current = postsRef.current;
    if (current.length === 0) return;
    setPostsLoadingMore(true);
    try {
      const last = current[current.length - 1];
      const next = await getCampaignPosts(campaignId, {
        limit: PAGE_SIZE,
        before: { createdAt: last.created_at, id: last.id },
      });
      setPosts((prev) => dedupAppendById(prev, next));
      setPostsHasMore(next.length >= PAGE_SIZE);
    } finally {
      setPostsLoadingMore(false);
    }
  }, [campaignId, postsHasMore, postsLoadingMore]);

  const loadMoreJobs = useCallback(async () => {
    if (jobsLoadingMore || !jobsHasMore) return;
    const current = jobsRef.current;
    if (current.length === 0) return;
    setJobsLoadingMore(true);
    try {
      const last = current[current.length - 1];
      const next = await getCampaignJobs(campaignId, {
        limit: PAGE_SIZE,
        before: { createdAt: last.created_at, id: last.id },
      });
      setJobs((prev) => dedupAppendById(prev, next));
      setJobsHasMore(next.length >= PAGE_SIZE);
    } finally {
      setJobsLoadingMore(false);
    }
  }, [campaignId, jobsHasMore, jobsLoadingMore]);

  return {
    posts,
    jobs,
    loading,
    postsHasMore,
    jobsHasMore,
    postsLoadingMore,
    jobsLoadingMore,
    loadMorePosts,
    loadMoreJobs,
    refresh,
  };
}
