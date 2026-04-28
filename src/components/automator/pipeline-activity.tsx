"use client";

import { useState, useCallback, useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  Clock,
  Loader2,
  MessageSquare,
  Trash2,
  UserX,
  RotateCcw,
} from "lucide-react";
import {
  purgeQueue,
  purgeAwaitingPosts,
  retryAwaitingPost,
} from "@/app/actions/pipeline";
import { toast } from "sonner";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { PipelineJobRow, PipelineJobDetail } from "./pipeline-job-row";
import { PipelinePostRow } from "./pipeline-post-row";
import { PipelineToolbar } from "./pipeline-toolbar";
import { PostDetailView } from "./post-detail-view";
import { filterJobs, filterPosts, type PlatformFilter } from "./post-filters";
import { usePipelineData } from "./use-pipeline-data";
import type { Campaign, CampaignPost, CampaignJobWithAvatar } from "@/types";

interface PipelineActivityProps {
  campaign: Campaign;
  pipelineVersion?: number;
}

export function PipelineActivity({
  campaign,
  pipelineVersion,
}: PipelineActivityProps) {
  const {
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
  } = usePipelineData({ campaignId: campaign.id, pipelineVersion });

  // NOTE: This component is mounted with `key={campaign.id}` by
  // CampaignDetailPanel, which resets all of the state below whenever the
  // operator switches to another campaign — no effect-based reset needed.
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedPostIndex, setSelectedPostIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");

  const handlePurge = async () => {
    const count = await purgeQueue(campaign.id);
    toast.success(`${count} job${count !== 1 ? "s" : ""} cancelled`);
    refresh();
  };

  const handlePurgeAwaiting = async () => {
    const count = await purgeAwaitingPosts(campaign.id);
    toast.success(`${count} awaiting post${count !== 1 ? "s" : ""} purged`);
    refresh();
  };

  const handleRetryPost = async (postId: string) => {
    const result = await retryAwaitingPost(postId);
    if (result.success) {
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
    refresh();
  };

  const filters = useMemo(
    () => ({ query: searchQuery, platform: platformFilter }),
    [searchQuery, platformFilter],
  );

  const postsById = useMemo(() => {
    const map = new Map<string, CampaignPost>();
    for (const post of posts) map.set(post.id, post);
    return map;
  }, [posts]);

  const filteredPosts = useMemo(
    () => filterPosts(posts, filters),
    [posts, filters],
  );

  const filteredJobs = useMemo(
    () => filterJobs(jobs, filters, postsById),
    [jobs, filters, postsById],
  );

  const queuedJobs = filteredJobs.filter(
    (j) => j.status === "ready" || j.status === "executing",
  );
  const completedJobs = filteredJobs.filter(
    (j) => j.status === "done" || j.status === "failed",
  );
  const awaitingPosts = filteredPosts.filter(
    (p) => p.status === "awaiting_avatars",
  );
  const selectedJob = selectedJobId ? jobs.find((j) => j.id === selectedJobId) : null;

  // Index by post id from the unfiltered job list so a post detail always shows
  // every response, even if the active filter would hide some of them.
  const jobsByPostId = useMemo(() => {
    const map = new Map<string, CampaignJobWithAvatar[]>();
    for (const job of jobs) {
      const list = map.get(job.campaign_post_id) ?? [];
      list.push(job);
      map.set(job.campaign_post_id, list);
    }
    return map;
  }, [jobs]);

  const toggleJob = (id: string) =>
    setSelectedJobId((prev) => (prev === id ? null : id));

  // Detail overlay browses the filtered list so its navigation arrows match the
  // posts the operator currently sees in the panel.
  const handleSelectPost = useCallback(
    (postId: string) => {
      const idx = filteredPosts.findIndex((p) => p.id === postId);
      if (idx !== -1) setSelectedPostIndex(idx);
    },
    [filteredPosts],
  );

  // If filters shrink the list while the overlay is open, clamp the displayed
  // index. We compute it lazily during render rather than syncing state in an
  // effect (React 19 idiom — derived state belongs in render).
  const safePostIndex = useMemo(() => {
    if (selectedPostIndex === null) return null;
    if (selectedPostIndex >= filteredPosts.length) {
      return filteredPosts.length > 0 ? 0 : null;
    }
    return selectedPostIndex;
  }, [selectedPostIndex, filteredPosts.length]);

  const handleNavigatePost = useCallback(
    (delta: -1 | 1) => {
      if (safePostIndex === null) return;
      const next = safePostIndex + delta;
      if (next < 0 || next >= filteredPosts.length) return;
      setSelectedPostIndex(next);
    },
    [safePostIndex, filteredPosts.length],
  );

  return (
    <div className="relative flex h-full flex-col">
      <PipelineToolbar
        posts={posts}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        platformFilter={platformFilter}
        onPlatformFilterChange={setPlatformFilter}
        availablePlatforms={campaign.platforms}
      />

      <Tabs defaultValue="posts" className="flex min-h-0 flex-1 flex-col">
        {/* Tab bar */}
        <div className="flex shrink-0 items-center overflow-x-auto border-b px-3 scrollbar-hide">
          <TabsList variant="line">
            <TabsTrigger value="posts" className="gap-1.5 text-[11px]">
              <MessageSquare className="h-3 w-3" />
              Posts
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {filteredPosts.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="queue" className="gap-1.5 text-[11px]">
              <Clock className="h-3 w-3" />
              Queue
              {queuedJobs.length > 0 && (
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {queuedJobs.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="awaiting" className="gap-1.5 text-[11px]">
              <UserX className="h-3 w-3" />
              Awaiting
              {awaitingPosts.length > 0 && (
                <span className="text-[10px] tabular-nums text-warning">
                  {awaitingPosts.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="activity" className="gap-1.5 text-[11px]">
              <Activity className="h-3 w-3" />
              Activity
              {completedJobs.length > 0 && (
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {completedJobs.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            {awaitingPosts.length > 0 && (
              <button
                onClick={handlePurgeAwaiting}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-2.5 w-2.5" />
                Purge awaiting
              </button>
            )}
            {queuedJobs.length > 0 && (
              <button
                onClick={handlePurge}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-2.5 w-2.5" />
                Purge queue
              </button>
            )}
          </div>
        </div>

        {/* Tab content */}
        <div className="min-h-0 flex-1">
          <TabsContent value="posts" className="h-full p-0">
            <ScrollArea className="h-full">
              <div className="space-y-px p-2">
                {loading && filteredPosts.length === 0 && <LoadingState />}
                {!loading && filteredPosts.length === 0 && (
                  <EmptyState
                    message={
                      posts.length === 0
                        ? "No posts processed yet"
                        : "No posts match the current filters"
                    }
                  />
                )}
                {filteredPosts.map((post) => (
                  <PipelinePostRow
                    key={post.id}
                    post={post}
                    responses={jobsByPostId.get(post.id) ?? []}
                    onSelect={() => handleSelectPost(post.id)}
                  />
                ))}
                <LoadMoreSentinel
                  hasMore={postsHasMore}
                  loading={postsLoadingMore}
                  onLoadMore={loadMorePosts}
                />
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="queue" className="h-full p-0">
            <ScrollArea className="h-full">
              <div className="space-y-px p-2">
                {loading && queuedJobs.length === 0 && <LoadingState />}
                {!loading && queuedJobs.length === 0 && (
                  <EmptyState message="Queue is empty" />
                )}
                {queuedJobs.map((job) => (
                  <PipelineJobRow
                    key={job.id}
                    job={job}
                    selected={job.id === selectedJobId}
                    onSelect={() => toggleJob(job.id)}
                  />
                ))}
                <LoadMoreSentinel
                  hasMore={jobsHasMore}
                  loading={jobsLoadingMore}
                  onLoadMore={loadMoreJobs}
                />
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="awaiting" className="h-full p-0">
            <ScrollArea className="h-full">
              <div className="space-y-px p-2">
                {loading && awaitingPosts.length === 0 && <LoadingState />}
                {!loading && awaitingPosts.length === 0 && (
                  <EmptyState message="No posts awaiting avatars" />
                )}
                {awaitingPosts.map((post) => (
                  <div key={post.id} className="group relative">
                    <PipelinePostRow
                      post={post}
                      responses={jobsByPostId.get(post.id) ?? []}
                      onSelect={() => handleSelectPost(post.id)}
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRetryPost(post.id);
                      }}
                      className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning opacity-0 transition-opacity hover:bg-warning/20 group-hover:opacity-100"
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      Retry
                    </button>
                  </div>
                ))}
                <LoadMoreSentinel
                  hasMore={postsHasMore}
                  loading={postsLoadingMore}
                  onLoadMore={loadMorePosts}
                />
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="activity" className="h-full p-0">
            <ScrollArea className="h-full">
              <div className="space-y-px p-2">
                {loading && completedJobs.length === 0 && <LoadingState />}
                {!loading && completedJobs.length === 0 && (
                  <EmptyState message="No completed jobs yet" />
                )}
                {completedJobs.map((job) => (
                  <PipelineJobRow
                    key={job.id}
                    job={job}
                    selected={job.id === selectedJobId}
                    onSelect={() => toggleJob(job.id)}
                  />
                ))}
                <LoadMoreSentinel
                  hasMore={jobsHasMore}
                  loading={jobsLoadingMore}
                  onLoadMore={loadMoreJobs}
                />
              </div>
            </ScrollArea>
          </TabsContent>
        </div>
      </Tabs>

      {/* Job detail drawer */}
      {selectedJob && (
        <PipelineJobDetail
          job={selectedJob}
          onClose={() => setSelectedJobId(null)}
        />
      )}

      {/* Post detail overlay — covers the entire panel */}
      {safePostIndex !== null && filteredPosts[safePostIndex] && (
        <PostDetailView
          posts={filteredPosts}
          currentIndex={safePostIndex}
          jobsByPostId={jobsByPostId}
          onClose={() => setSelectedPostIndex(null)}
          onNavigate={handleNavigatePost}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared empty / loading states
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
      Loading...
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-8 text-center text-xs text-muted-foreground">
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sentinel — observed by IntersectionObserver to trigger cursor-based paging.
// Disabled while a fetch is in flight to avoid duplicate triggers.
// ---------------------------------------------------------------------------

function LoadMoreSentinel({
  hasMore,
  loading,
  onLoadMore,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}) {
  const ref = useInfiniteScroll<HTMLDivElement>({
    enabled: hasMore && !loading,
    onLoadMore,
  });

  if (!hasMore && !loading) return null;

  return (
    <div
      ref={ref}
      className="flex items-center justify-center gap-1.5 py-4 text-[10px] text-muted-foreground"
    >
      {loading && <Loader2 className="h-3 w-3 animate-spin" />}
      <span className="opacity-70">
        {loading ? "Loading more…" : "Scroll to load more"}
      </span>
    </div>
  );
}
