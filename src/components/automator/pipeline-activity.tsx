"use client";

import { useState, useEffect, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Ban,
  Timer,
  Trash2,
  MessageSquare,
  Eye,
} from "lucide-react";
import { getCampaignPosts, getCampaignJobs, purgeQueue } from "@/app/actions/pipeline";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import type { Campaign, CampaignPost, CampaignJob, CampaignJobStatus } from "@/types";

interface PipelineActivityProps {
  campaign: Campaign;
}

export function PipelineActivity({ campaign }: PipelineActivityProps) {
  const [posts, setPosts] = useState<CampaignPost[]>([]);
  const [jobs, setJobs] = useState<CampaignJob[]>([]);
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
    toast.success(`${count} jobs cancelled`);
    refresh();
  };

  const queuedJobs = jobs.filter((j) => j.status === "ready" || j.status === "executing");
  const completedJobs = jobs.filter((j) => j.status === "done" || j.status === "failed");
  const selectedJob = selectedJobId ? jobs.find((j) => j.id === selectedJobId) : null;

  return (
    <div className="flex h-full flex-col">
      <Tabs defaultValue="queue" className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b px-3">
          <TabsList variant="line">
            <TabsTrigger value="queue" className="gap-1.5 text-[11px]">
              <Clock className="h-3 w-3" />
              Queue
              {queuedJobs.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                  {queuedJobs.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="activity" className="gap-1.5 text-[11px]">
              <Activity className="h-3 w-3" />
              Activity
            </TabsTrigger>
            <TabsTrigger value="posts" className="gap-1.5 text-[11px]">
              <MessageSquare className="h-3 w-3" />
              Posts
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                {posts.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          {queuedJobs.length > 0 && (
            <button
              onClick={handlePurge}
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
              Purge
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1">
          <TabsContent value="queue" className="h-full p-0">
            <ScrollArea className="h-full">
              <div className="space-y-px p-2">
                {loading && queuedJobs.length === 0 && (
                  <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Loading...
                  </div>
                )}
                {!loading && queuedJobs.length === 0 && (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    Queue is empty
                  </div>
                )}
                {queuedJobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    selected={job.id === selectedJobId}
                    onSelect={() => setSelectedJobId(job.id === selectedJobId ? null : job.id)}
                  />
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="activity" className="h-full p-0">
            <ScrollArea className="h-full">
              <div className="space-y-px p-2">
                {completedJobs.length === 0 && (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No completed jobs yet
                  </div>
                )}
                {completedJobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    selected={job.id === selectedJobId}
                    onSelect={() => setSelectedJobId(job.id === selectedJobId ? null : job.id)}
                  />
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="posts" className="h-full p-0">
            <ScrollArea className="h-full">
              <div className="space-y-px p-2">
                {posts.length === 0 && (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No posts processed yet
                  </div>
                )}
                {posts.map((post) => (
                  <PostRow key={post.id} post={post} />
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
        </div>
      </Tabs>

      {selectedJob && <JobDetail job={selectedJob} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job row
// ---------------------------------------------------------------------------

function JobRow({
  job,
  selected,
  onSelect,
}: {
  job: CampaignJob;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
        selected ? "bg-accent" : "hover:bg-muted/50"
      }`}
    >
      <JobStatusIcon status={job.status} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{job.comment_text}</p>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{job.platform}</span>
          <span>·</span>
          <span>{formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}</span>
          {job.duration_ms && <span>· {(job.duration_ms / 1000).toFixed(1)}s</span>}
        </div>
      </div>
      <JobStatusBadge status={job.status} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Post row
// ---------------------------------------------------------------------------

function PostRow({ post }: { post: CampaignPost }) {
  const decision = post.ai_decision;

  return (
    <div className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs">
      {post.status === "responded" ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
      ) : post.status === "filtered_out" ? (
        <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
      ) : (
        <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {post.post_author ? `@${post.post_author}` : "Unknown"}: {post.post_text}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{post.platform}</span>
          <span>·</span>
          <span>{post.status}</span>
          {decision && (
            <>
              <span>·</span>
              <span>{decision.reason}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job detail panel
// ---------------------------------------------------------------------------

function JobDetail({ job }: { job: CampaignJob }) {
  return (
    <div className="shrink-0 border-t bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold">Job Detail</h4>
        <JobStatusBadge status={job.status} />
      </div>

      <div className="mt-2 space-y-1.5 text-[11px]">
        <div>
          <span className="text-muted-foreground">Comment: </span>
          <span>{job.comment_text}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Post URL: </span>
          <a href={job.post_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {job.post_url}
          </a>
        </div>
        {job.error_message && (
          <div>
            <span className="text-destructive">Error: </span>
            <span className="text-destructive">{job.error_message}</span>
          </div>
        )}
        {job.duration_ms && (
          <div>
            <span className="text-muted-foreground">Duration: </span>
            <span>{(job.duration_ms / 1000).toFixed(1)}s</span>
          </div>
        )}

        {(job.source_screenshot || job.proof_screenshot) && (
          <div className="mt-2 flex gap-2">
            {job.source_screenshot && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Eye className="h-3 w-3" />
                Source screenshot
              </div>
            )}
            {job.proof_screenshot && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Eye className="h-3 w-3" />
                Proof screenshot
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function JobStatusIcon({ status }: { status: CampaignJobStatus }) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />;
    case "failed":
      return <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />;
    case "executing":
      return <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />;
    case "cancelled":
      return <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />;
    case "expired":
      return <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500/60" />;
    default:
      return <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />;
  }
}

function JobStatusBadge({ status }: { status: CampaignJobStatus }) {
  const variant = status === "done" ? "default"
    : status === "failed" ? "destructive"
    : "secondary";

  return <Badge variant={variant} className="text-[9px]">{status}</Badge>;
}
