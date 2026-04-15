"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Ban,
  Clock,
  AlertTriangle,
  Loader2,
  ExternalLink,
  ChevronDown,
  Eye,
  Heart,
  MessageCircle,
  Repeat2,
  Quote,
  Play,
  ThumbsUp,
  Share2,
  Bookmark,
  User,
  Reply,
} from "lucide-react";
import { SocialIcon } from "@/components/icons/social-icons";
import { DeviceScreenshot } from "./device-screenshot";
import { JobStatusIcon, JobStatusBadge } from "./pipeline-status";
import { formatDistanceToNow } from "date-fns";
import type {
  CampaignPost,
  CampaignPostStatus,
  CampaignJobWithAvatar,
  SocialPlatform,
} from "@/types";

// ---------------------------------------------------------------------------
// Post card — shows source post + linked responses
// ---------------------------------------------------------------------------

interface PipelinePostRowProps {
  post: CampaignPost;
  responses: CampaignJobWithAvatar[];
}

export function PipelinePostRow({ post, responses }: PipelinePostRowProps) {
  const [expanded, setExpanded] = useState(false);
  const decision = post.ai_decision;
  const metrics = post.post_metrics as Record<string, number | undefined>;
  const hasMetrics = Object.keys(metrics).length > 0;
  const doneResponses = responses.filter((r) => r.status === "done");
  const sourceScreenshot = responses.find((r) => r.source_screenshot)?.source_screenshot;

  return (
    <div
      className={cn(
        "rounded-lg border transition-colors",
        expanded ? "border-border bg-card" : "border-transparent hover:border-border/40"
      )}
    >
      {/* Collapsed header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-2.5 px-2.5 py-2 text-left text-xs"
      >
        <PostStatusIcon status={post.status} />

        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug">
            {post.post_author && (
              <span className="text-primary">@{post.post_author} </span>
            )}
            <span
              className={cn(
                "text-foreground",
                !expanded && "truncate-multiline truncate-2"
              )}
            >
              {post.post_text}
            </span>
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-0.5">
              <SocialIcon
                platform={post.platform as SocialPlatform}
                className="h-2.5 w-2.5"
              />
              {post.platform}
            </span>
            <PostStatusLabel status={post.status} />
            <span>
              {formatDistanceToNow(new Date(post.created_at), {
                addSuffix: true,
              })}
            </span>
          </div>

          {/* Compact row: metrics + response count */}
          <div className="mt-1.5 flex items-center gap-2">
            {hasMetrics && !expanded && (
              <div className="flex flex-wrap gap-1">
                {renderMetricChips(metrics, 3)}
              </div>
            )}
            {responses.length > 0 && (
              <Badge
                variant="secondary"
                className="ml-auto gap-1 text-[9px] tabular-nums"
              >
                <Reply className="h-2.5 w-2.5" />
                {doneResponses.length}/{responses.length}
              </Badge>
            )}
          </div>
        </div>

        <ChevronDown
          className={cn(
            "mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border/50">
          {/* Engagement + AI + source screenshot */}
          <div className="space-y-3 px-3 pb-3 pt-2.5">
            {/* Engagement metrics */}
            {hasMetrics && (
              <DetailSection label="Engagement">
                <div className="flex flex-wrap gap-1.5">
                  {renderMetricChips(metrics)}
                </div>
              </DetailSection>
            )}

            {/* AI analysis */}
            {decision && (
              <DetailSection label="AI Analysis">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={decision.relevant ? "default" : "secondary"}
                      className="text-[9px]"
                    >
                      {decision.relevant ? "Relevant" : "Filtered"}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {decision.suggested_avatar_count} avatar
                      {decision.suggested_avatar_count !== 1 ? "s" : ""}{" "}
                      suggested
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {decision.reason}
                  </p>
                </div>
              </DetailSection>
            )}

            {/* Source capture */}
            <DetailSection label="Source capture">
              <DeviceScreenshot
                url={sourceScreenshot}
                alt={`Source: ${post.post_author ?? "post"}`}
              />
            </DetailSection>
          </div>

          {/* Responses section */}
          {responses.length > 0 && (
            <div className="border-t border-border/50">
              <div className="flex items-center gap-2 px-3 py-2">
                <Reply className="h-3 w-3 text-muted-foreground/60" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Responses ({responses.length})
                </span>
              </div>
              <div className="space-y-px px-2 pb-2">
                {responses.map((job) => (
                  <ResponseCard key={job.id} job={job} />
                ))}
              </div>
            </div>
          )}

          {/* Footer link */}
          {post.post_url && (
            <div className="border-t border-border/50 px-3 py-2">
              <a
                href={post.post_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
              >
                Open original post
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Response card — a single job/response nested under its source post
// ---------------------------------------------------------------------------

function ResponseCard({ job }: { job: CampaignJobWithAvatar }) {
  return (
    <div className="rounded-md border border-border/40 bg-muted/10 p-2.5">
      {/* Header: avatar + status */}
      <div className="flex items-center gap-2">
        <JobStatusIcon status={job.status} className="h-3 w-3" />
        {job.avatar_name ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium">
            <User className="h-2.5 w-2.5 text-muted-foreground/60" />
            {job.avatar_name}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">Unknown avatar</span>
        )}
        <JobStatusBadge status={job.status} className="ml-auto" />
        {job.duration_ms != null && (
          <span className="text-[9px] tabular-nums text-muted-foreground">
            {(job.duration_ms / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {/* Comment text */}
      <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/80">
        {job.comment_text}
      </p>

      {/* Error message */}
      {job.error_message && (
        <p className="mt-1 text-[10px] text-destructive">
          {job.error_message}
        </p>
      )}

      {/* Proof screenshot */}
      <div className="mt-2">
        <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Proof
        </span>
        <div className="mt-1">
          <DeviceScreenshot
            url={job.proof_screenshot}
            alt={`Proof: ${job.avatar_name ?? "response"}`}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail section wrapper
// ---------------------------------------------------------------------------

function DetailSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric chips
// ---------------------------------------------------------------------------

const METRIC_CONFIG: Record<string, { icon: typeof Eye; label: string }> = {
  view_count: { icon: Eye, label: "Views" },
  like_count: { icon: Heart, label: "Likes" },
  reply_count: { icon: MessageCircle, label: "Replies" },
  retweet_count: { icon: Repeat2, label: "RTs" },
  quote_count: { icon: Quote, label: "Quotes" },
  play_count: { icon: Play, label: "Plays" },
  digg_count: { icon: ThumbsUp, label: "Likes" },
  comment_count: { icon: MessageCircle, label: "Comments" },
  share_count: { icon: Share2, label: "Shares" },
  collect_count: { icon: Bookmark, label: "Saves" },
};

function renderMetricChips(
  metrics: Record<string, number | undefined>,
  limit?: number
) {
  const entries = Object.entries(metrics)
    .filter(([, v]) => v != null && v > 0)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0));

  const visible = limit ? entries.slice(0, limit) : entries;

  return visible.map(([key, value]) => {
    const Icon = METRIC_CONFIG[key]?.icon ?? Eye;

    return (
      <span
        key={key}
        className="inline-flex items-center gap-0.5 rounded-md bg-muted/60 px-1.5 py-0.5 text-[9px] tabular-nums text-muted-foreground"
      >
        <Icon className="h-2.5 w-2.5" />
        {formatCount(value ?? 0)}
      </span>
    );
  });
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

// ---------------------------------------------------------------------------
// Post status helpers
// ---------------------------------------------------------------------------

const POST_STATUS_ICON: Record<
  CampaignPostStatus,
  { icon: typeof Clock; className: string }
> = {
  responded: { icon: CheckCircle2, className: "text-success" },
  filtered_out: { icon: Ban, className: "text-muted-foreground/50" },
  error: { icon: AlertTriangle, className: "text-destructive" },
  processing: { icon: Loader2, className: "animate-spin text-info" },
  pending: { icon: Clock, className: "text-warning" },
};

function PostStatusIcon({ status }: { status: CampaignPostStatus }) {
  const config = POST_STATUS_ICON[status];
  const Icon = config.icon;
  return (
    <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", config.className)} />
  );
}

function PostStatusLabel({ status }: { status: CampaignPostStatus }) {
  const labels: Record<CampaignPostStatus, string> = {
    responded: "Responded",
    filtered_out: "Filtered",
    error: "Error",
    processing: "Processing",
    pending: "Pending",
  };
  return <span>{labels[status]}</span>;
}

