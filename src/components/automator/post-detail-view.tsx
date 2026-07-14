"use client";

import { useEffect, useCallback } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Languages,
  UserX,
  Filter,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SocialIcon } from "@/components/icons/social-icons";
import { JobVerdict, JobEvidence } from "./pipeline-job-row";
import { JobStatusLabel, PostStatusBadge } from "./pipeline-status";
import { renderMetricChips, ResponseOutcome } from "./pipeline-post-row";
import { PostAuthorAvatar } from "./post-author-avatar";
import { SentimentChip } from "./sentiment-chip";
import { RelativeTime } from "./relative-time";
import type {
  CampaignPost,
  CampaignJobWithAvatar,
  CampaignPostStatus,
  SocialPlatform,
} from "@/types";

// ---------------------------------------------------------------------------
// Post detail overlay — result-first. The operator opens it to answer ONE
// question: "did we respond, and did it work?" — so responses (verdict +
// evidence) come first; the source post and AI reasoning follow as context.
// ---------------------------------------------------------------------------

interface PostDetailViewProps {
  posts: CampaignPost[];
  currentIndex: number;
  jobsByPostId: Map<string, CampaignJobWithAvatar[]>;
  onClose: () => void;
  onNavigate: (delta: -1 | 1) => void;
}

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
    [onClose, onNavigate, isFirst, isLast],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-background">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="sr-only">Back to list</span>
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
            <span className="sr-only">Previous post</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={isLast}
            onClick={() => onNavigate(1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="sr-only">Next post</span>
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          {/* ------------------------------------------------------------- */}
          {/* 1. OUTCOME — what happened for this post                       */}
          {/* ------------------------------------------------------------- */}
          <div className="flex flex-wrap items-center gap-2">
            <PostStatusBadge status={post.status} />
            <ResponseOutcome responses={responses} />
          </div>

          {responses.length > 0 ? (
            <div className="space-y-2.5">
              {responses.map((job) => (
                <ResponseCard key={job.id} job={job} />
              ))}
            </div>
          ) : (
            <NoResponseNote status={post.status} />
          )}

          {/* ------------------------------------------------------------- */}
          {/* 2. SOURCE POST — what we responded to                          */}
          {/* ------------------------------------------------------------- */}
          <Section label="Source post">
            <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                <PostAuthorAvatar
                  handle={post.post_author}
                  imageUrl={post.author_avatar_url}
                  className="shrink-0"
                />
                <SocialIcon
                  platform={post.platform as SocialPlatform}
                  className="h-3 w-3 shrink-0 text-muted-foreground"
                />
                <span className="truncate text-[13px] font-semibold">
                  @{post.post_author ?? "unknown"}
                </span>
                <RelativeTime
                  iso={post.source_posted_at ?? post.created_at}
                  prefix="posted "
                  className="shrink-0 text-[11px] text-muted-foreground"
                />
                {post.post_url && (
                  <a
                    href={post.post_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                  >
                    Open
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>

              <p dir="auto" className="mt-1.5 text-xs leading-relaxed text-foreground">
                {post.post_text}
              </p>

              {post.translation_text && post.translation_lang && (
                <div className="mt-2 flex items-start gap-1.5 border-t border-border/50 pt-2">
                  <Languages className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/70" />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    <span className="font-medium uppercase">
                      {post.translation_lang}
                    </span>{" "}
                    · {post.translation_text}
                  </p>
                </div>
              )}

              {hasMetrics && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {renderMetricChips(metrics)}
                </div>
              )}
            </div>
          </Section>

          {/* ------------------------------------------------------------- */}
          {/* 3. AI REASONING — why the pipeline engaged (or not)            */}
          {/* ------------------------------------------------------------- */}
          {(decision || post.sentiment_label) && (
            <Section label="AI decision">
              <div className="flex flex-wrap items-center gap-2">
                {decision && (
                  <Badge
                    variant={decision.relevant ? "default" : "secondary"}
                    className="text-[10px]"
                  >
                    {decision.relevant ? "Relevant" : "Filtered"}
                  </Badge>
                )}
                {post.sentiment_label && (
                  <SentimentChip
                    label={post.sentiment_label}
                    score={post.sentiment_score}
                    variant="detailed"
                  />
                )}
                {decision && (
                  <span className="text-[11px] text-muted-foreground">
                    {decision.suggested_avatar_count} avatar
                    {decision.suggested_avatar_count !== 1 ? "s" : ""} suggested
                  </span>
                )}
              </div>
              {decision?.reason && (
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {decision.reason}
                </p>
              )}
            </Section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Response card — verdict banner, avatar + comment, labeled evidence thumbs
// ---------------------------------------------------------------------------

function ResponseCard({ job }: { job: CampaignJobWithAvatar }) {
  const pending = job.status === "ready" || job.status === "executing";
  // The moment the avatar actually acted (comment/reply sent), from
  // `completed_at`. This is the customer-facing "when" — distinct from the
  // execution duration (telemetry), which stays out of this card.
  const actedPrefix = job.status === "done" ? "published " : "attempted ";

  return (
    <div className="rounded-md border border-border/60 px-2.5 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="truncate text-[13px] font-semibold">
          {job.avatar_name ?? "Unknown avatar"}
        </span>
        <span className="ml-auto shrink-0">
          <JobStatusLabel status={job.status} />
        </span>
      </div>

      {!pending && job.completed_at && (
        <RelativeTime
          iso={job.completed_at}
          prefix={actedPrefix}
          className="mt-0.5 block text-[11px] text-muted-foreground"
        />
      )}

      <p dir="auto" className="mt-1 text-xs leading-relaxed text-foreground">
        {job.comment_text}
      </p>

      <div className="mt-2 space-y-2">
        {pending ? (
          <p className="text-[11px] italic text-muted-foreground">
            Waiting for a device slot — evidence appears once the job runs.
          </p>
        ) : (
          <JobVerdict job={job} />
        )}
        <JobEvidence job={job} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// No-response note — explains WHY nothing was posted, per post status
// ---------------------------------------------------------------------------

const NO_RESPONSE_NOTE: Partial<
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
    message: "Expired before an avatar became available — no response was posted.",
  },
};

function NoResponseNote({ status }: { status: CampaignPostStatus }) {
  const config = NO_RESPONSE_NOTE[status] ?? {
    icon: Clock,
    color: "text-muted-foreground",
    message: "No response has been posted for this post.",
  };
  const Icon = config.icon;
  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed border-border/50 bg-muted/20 px-3 py-3">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", config.color)} />
      <p className="text-xs leading-relaxed text-muted-foreground">
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
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
