"use client";

import { useEffect, useCallback } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Languages,
  User,
  UserX,
  Filter,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SocialIcon } from "@/components/icons/social-icons";
import { DeviceScreenshot } from "./device-screenshot";
import { JobStatusIcon, JobStatusLabel, PostStatusBadge } from "./pipeline-status";
import { renderMetricChips } from "./pipeline-post-row";
import { SentimentChip } from "./sentiment-chip";
import { formatDistanceToNow } from "date-fns";
import type {
  CampaignPost,
  CampaignJobWithAvatar,
  CampaignPostStatus,
  SocialPlatform,
} from "@/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PostDetailViewProps {
  posts: CampaignPost[];
  currentIndex: number;
  jobsByPostId: Map<string, CampaignJobWithAvatar[]>;
  onClose: () => void;
  onNavigate: (delta: -1 | 1) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PostDetailView({
  posts,
  currentIndex,
  jobsByPostId,
  onClose,
  onNavigate,
}: PostDetailViewProps) {
  const post = posts[currentIndex];
  const responses = jobsByPostId.get(post.id) ?? [];
  const decision = post.ai_decision;
  const metrics = post.post_metrics as Record<string, number | undefined>;
  const hasMetrics = Object.values(metrics).some((v) => v != null && v > 0);
  const sourceScreenshot = responses.find(
    (r) => r.source_screenshot
  )?.source_screenshot;

  const isFirst = currentIndex === 0;
  const isLast = currentIndex === posts.length - 1;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft" && !isFirst) {
        onNavigate(-1);
      } else if (e.key === "ArrowRight" && !isLast) {
        onNavigate(1);
      }
    },
    [onClose, onNavigate, isFirst, isLast]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-background">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>

        <span className="min-w-0 flex-1 text-caption normal-case">
          Post {currentIndex + 1} / {posts.length}
        </span>

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={isFirst}
            onClick={() => onNavigate(-1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={isLast}
            onClick={() => onNavigate(1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Scrollable content */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          {/* Post content */}
          <div>
            <div className="flex items-start gap-2">
              <PostStatusBadge status={post.status} />
              <div className="min-w-0 flex-1">
                {post.post_author && (
                  <p className="text-xs font-medium text-primary">
                    @{post.post_author}
                  </p>
                )}
                <p className="mt-0.5 text-xs leading-relaxed text-foreground">
                  {post.post_text}
                </p>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-0.5">
                <SocialIcon
                  platform={post.platform as SocialPlatform}
                  className="h-2.5 w-2.5"
                />
                {post.platform}
              </span>
              {post.source_posted_at ? (
                <>
                  <span title="When the post was published upstream">
                    Posted{" "}
                    {formatDistanceToNow(new Date(post.source_posted_at), {
                      addSuffix: true,
                    })}
                  </span>
                  <span
                    className="text-muted-foreground/60"
                    title="When Attila ingested the post"
                  >
                    · Detected{" "}
                    {formatDistanceToNow(new Date(post.created_at), {
                      addSuffix: true,
                    })}
                  </span>
                </>
              ) : (
                <span title="When Attila ingested the post">
                  Detected{" "}
                  {formatDistanceToNow(new Date(post.created_at), {
                    addSuffix: true,
                  })}
                </span>
              )}
              {post.post_url && (
                <a
                  href={post.post_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  Open original
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
          </div>

          {/* Translation — surfaced when Gorgone V4 produced one for the
              account locale. The original is already in the post body
              above, so we only show the translated text here. */}
          {post.translation_text && post.translation_lang && (
            <Section label={`Translation (${post.translation_lang.toUpperCase()})`}>
              <div className="flex items-start gap-1.5">
                <Languages className="mt-0.5 h-2.5 w-2.5 shrink-0 text-muted-foreground/70" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {post.translation_text}
                </p>
              </div>
            </Section>
          )}

          {/* Engagement */}
          {hasMetrics && (
            <Section label="Engagement">
              <div className="flex flex-wrap gap-1.5">
                {renderMetricChips(metrics)}
              </div>
            </Section>
          )}

          {/* AI signals — Gorgone-side sentiment + Attila-side analyst
              decision. We display them together so the operator can
              reconcile the two sources at a glance. Either may be null. */}
          {(decision || post.sentiment_label) && (
            <Section label="AI Signals">
              <div className="flex flex-wrap items-center gap-2">
                {post.sentiment_label && (
                  <SentimentChip
                    label={post.sentiment_label}
                    score={post.sentiment_score}
                    variant="detailed"
                  />
                )}
                {decision && (
                  <>
                    <Badge
                      variant={decision.relevant ? "default" : "secondary"}
                      className="text-[9px]"
                    >
                      {decision.relevant ? "Relevant" : "Filtered"}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {decision.suggested_avatar_count} suggested avatar
                      {decision.suggested_avatar_count !== 1 ? "s" : ""}
                    </span>
                  </>
                )}
              </div>
              {decision && (
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {decision.reason}
                </p>
              )}
            </Section>
          )}

          {/* Source screenshot — full width. Only meaningful once a
              response job exists. For posts that never reached the queue
              (no avatar available) we explain why instead of showing a
              misleading "pending capture" placeholder. */}
          <Section label="Source Capture">
            {sourceScreenshot || responses.length > 0 ? (
              <DeviceScreenshot
                url={sourceScreenshot}
                alt={`Source: ${post.post_author ?? "post"}`}
              />
            ) : (
              <NoCaptureNote status={post.status} />
            )}
          </Section>

          {/* Responses — text on top, proof screenshot directly below */}
          {responses.length > 0 && (
            <Section label={`Responses (${responses.length})`}>
              <div className="divide-y divide-border/60">
                {responses.map((job) => (
                  <div key={job.id} className="py-3 first:pt-0 last:pb-0">
                    <ResponseDetailCard job={job} />
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Response detail card — mirrors the source-post layout: avatar attribution
// + the comment text sit on top, the proof screenshot is directly below it
// (no nested padding/borders so the text/screenshot pair reads as one unit).
// ---------------------------------------------------------------------------

function ResponseDetailCard({ job }: { job: CampaignJobWithAvatar }) {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <JobStatusIcon status={job.status} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-1 text-xs font-medium text-primary">
            <User className="h-2.5 w-2.5 text-primary/70" />
            {job.avatar_name ?? "Unknown avatar"}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-foreground">
            {job.comment_text}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
            <JobStatusLabel status={job.status} />
            {job.duration_ms != null && (
              <span className="tabular-nums">
                {(job.duration_ms / 1000).toFixed(1)}s
              </span>
            )}
          </div>

          {job.error_message && (
            <p className="mt-1 text-[10px] text-destructive">
              {job.error_message}
            </p>
          )}
        </div>
      </div>

      <DeviceScreenshot
        url={job.proof_screenshot}
        alt={`Proof: ${job.avatar_name ?? "response"}`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// No-capture note — shown in place of the screenshot placeholder for posts
// that never produced a response job, so "pending capture" never implies an
// action is on its way when none is.
// ---------------------------------------------------------------------------

const NO_CAPTURE_NOTE: Partial<
  Record<CampaignPostStatus, { icon: typeof Clock; color: string; message: string }>
> = {
  awaiting_avatars: {
    icon: UserX,
    color: "text-warning",
    message:
      "Waiting for an available avatar — no response has been posted yet. Check the campaign's army selection.",
  },
  filtered_out: {
    icon: Filter,
    color: "text-muted-foreground",
    message:
      "Expired before an avatar became available — no response was posted.",
  },
};

function NoCaptureNote({ status }: { status: CampaignPostStatus }) {
  const config = NO_CAPTURE_NOTE[status] ?? {
    icon: Clock,
    color: "text-muted-foreground",
    message: "No response has been posted for this post.",
  };
  const Icon = config.icon;
  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed border-border/50 bg-muted/20 px-3 py-3">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", config.color)} />
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {config.message}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="text-caption">{label}</span>
      <div className="mt-1">{children}</div>
    </div>
  );
}
