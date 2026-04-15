"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  Clock,
  Loader2,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { getCampaignPosts, getCampaignJobs, purgeQueue } from "@/app/actions/pipeline";
import { toast } from "sonner";
import { PipelineJobRow, PipelineJobDetail } from "./pipeline-job-row";
import { PipelinePostRow } from "./pipeline-post-row";
import type { Campaign, CampaignPost, CampaignJobWithAvatar } from "@/types";

interface PipelineActivityProps {
  campaign: Campaign;
}

export function PipelineActivity({ campaign }: PipelineActivityProps) {
  const [posts, setPosts] = useState<CampaignPost[]>([]);
  const [jobs, setJobs] = useState<CampaignJobWithAvatar[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [p, j] = await Promise.all([
      getCampaignPosts(campaign.id),
      getCampaignJobs(campaign.id),
    ]);
    setPosts(p);
    setJobs(j);
    setLoading(false);
  }, [campaign.id]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handlePurge = async () => {
    const count = await purgeQueue(campaign.id);
    toast.success(`${count} job${count !== 1 ? "s" : ""} cancelled`);
    refresh();
  };

  const queuedJobs = jobs.filter((j) => j.status === "ready" || j.status === "executing");
  const completedJobs = jobs.filter((j) => j.status === "done" || j.status === "failed");
  const selectedJob = selectedJobId ? jobs.find((j) => j.id === selectedJobId) : null;

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

  return (
    <div className="flex h-full flex-col">
      <Tabs defaultValue="posts" className="flex min-h-0 flex-1 flex-col">
        {/* Tab bar */}
        <div className="flex shrink-0 items-center justify-between border-b px-3">
          <TabsList variant="line">
            <TabsTrigger value="posts" className="gap-1.5 text-[11px]">
              <MessageSquare className="h-3 w-3" />
              Posts
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px] tabular-nums">
                {posts.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="queue" className="gap-1.5 text-[11px]">
              <Clock className="h-3 w-3" />
              Queue
              {queuedJobs.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px] tabular-nums">
                  {queuedJobs.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="activity" className="gap-1.5 text-[11px]">
              <Activity className="h-3 w-3" />
              Activity
              {completedJobs.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px] tabular-nums">
                  {completedJobs.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {queuedJobs.length > 0 && (
            <button
              onClick={handlePurge}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
              Purge
            </button>
          )}
        </div>

        {/* Tab content */}
        <div className="min-h-0 flex-1">
          <TabsContent value="posts" className="h-full p-0">
            <ScrollArea className="h-full">
              <div className="space-y-1.5 p-2">
                {loading && posts.length === 0 && <LoadingState />}
                {!loading && posts.length === 0 && (
                  <EmptyState message="No posts processed yet" />
                )}
                {posts.map((post) => (
                  <PipelinePostRow
                    key={post.id}
                    post={post}
                    responses={jobsByPostId.get(post.id) ?? []}
                  />
                ))}
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
