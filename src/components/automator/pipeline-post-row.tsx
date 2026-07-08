"use client";

import {
  Eye,
  Heart,
  MessageCircle,
  Repeat2,
  Quote,
  Play,
  ThumbsUp,
  Share2,
  Bookmark,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
} from "lucide-react";
import { PostStatusBadge } from "./pipeline-status";
import { SentimentChip } from "./sentiment-chip";
import { SocialIcon } from "@/components/icons/social-icons";
import { PostAuthorAvatar } from "./post-author-avatar";
import { formatDistanceToNow } from "date-fns";
import { formatCount } from "@/lib/format";
import type { EngagementMetricKey } from "@/lib/pipeline/engagement-keys";
import type {
  CampaignPost,
  CampaignJobWithAvatar,
  SocialPlatform,
} from "@/types";

// ---------------------------------------------------------------------------
// Post row — compact list item, click opens detail overlay.
// Reads top-to-bottom: WHO posted → WHAT they said → WHAT WE DID about it.
// The outcome line is the load-bearing signal (published / failed / queued),
// spelled out with words and color instead of a bare "1/3" fraction.
// ---------------------------------------------------------------------------

interface PipelinePostRowProps {
  post: CampaignPost;
  responses: CampaignJobWithAvatar[];
  onSelect: () => void;
}

export function PipelinePostRow({
  post,
  responses,
  onSelect,
}: PipelinePostRowProps) {
  const metrics = post.post_metrics as Record<string, number | undefined>;
  const hasMetrics = Object.keys(metrics).length > 0;
  const sourceScreenshot = responses.find(
    (r) => r.source_screenshot,
  )?.source_screenshot;

  return (
    // Clickable card with a real nested link: an absolute button layer catches
    // the "open detail" click, while the source-post link sits on top with its
    // own pointer target — valid HTML (no <a> inside <button>) and accessible.
    <div className="group relative rounded-md transition-colors hover:bg-muted/50">
      <button
        onClick={onSelect}
        aria-label={`View responses for @${post.post_author ?? "unknown"}`}
        className="absolute inset-0 z-0 rounded-md"
      />
      <div className="pointer-events-none relative z-10 flex items-start gap-2.5 px-2.5 py-2.5">
        <div className="min-w-0 flex-1">
          {/* WHO + status */}
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
            <span className="truncate text-[13px] font-semibold text-foreground">
              @{post.post_author ?? "unknown"}
            </span>
            <span
              className="shrink-0 text-[11px] text-muted-foreground"
              title={
                post.source_posted_at
                  ? "When the post was published on the platform"
                  : "When Attila detected the post"
              }
            >
              {formatDistanceToNow(
                new Date(post.source_posted_at ?? post.created_at),
                { addSuffix: true },
              )}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {post.post_url && (
                <a
                  href={post.post_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title="Open the original post"
                  className="pointer-events-auto inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-medium text-primary opacity-0 transition-opacity hover:underline focus-visible:opacity-100 group-hover:opacity-100"
                >
                  Open
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
              <PostStatusBadge status={post.status} />
            </span>
          </div>

          {/* WHAT they said */}
          <p className="truncate-multiline truncate-2 mt-1 text-xs leading-normal text-muted-foreground">
            {post.post_text}
          </p>

          {/* WHAT WE DID — outcome per response, spelled out */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <ResponseOutcome responses={responses} />
            <SentimentChip
              label={post.sentiment_label}
              score={post.sentiment_score}
            />
            {hasMetrics && (
              <span className="ml-auto flex gap-1">
                {renderMetricChips(metrics, 2)}
              </span>
            )}
          </div>
        </div>

        {/* Source thumbnail */}
        {sourceScreenshot && (
          <div className="mt-0.5 aspect-[9/16] w-9 shrink-0 overflow-hidden rounded border border-border/40">
            <img
              src={sourceScreenshot}
              alt={`Source: ${post.post_author ?? "post"}`}
              loading="lazy"
              className="h-full w-full object-cover object-top"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outcome summary — one colored chip per outcome bucket, in words
// ---------------------------------------------------------------------------

export function ResponseOutcome({
  responses,
}: {
  responses: CampaignJobWithAvatar[];
}) {
  if (responses.length === 0) return null;

  const published = responses.filter((r) => r.status === "done").length;
  const failed = responses.filter((r) => r.status === "failed").length;
  const inFlight = responses.filter(
    (r) => r.status === "ready" || r.status === "executing",
  ).length;

  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-medium">
      {published > 0 && (
        <span className="inline-flex items-center gap-1 text-success">
          <CheckCircle2 className="h-3 w-3" />
          {published} published
        </span>
      )}
      {failed > 0 && (
        <span className="inline-flex items-center gap-1 text-destructive">
          <XCircle className="h-3 w-3" />
          {failed} failed
        </span>
      )}
      {inFlight > 0 && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Clock className="h-3 w-3" />
          {inFlight} queued
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Metric chips
// ---------------------------------------------------------------------------
// `EngagementMetricKey` (single source of truth) drives the icon map. Adding
// a key in `lib/pipeline/engagement-keys.ts` therefore requires extending
// this map — TypeScript catches the omission.

const METRIC_ICON: Record<EngagementMetricKey, typeof Eye> = {
  view_count: Eye,
  like_count: Heart,
  reply_count: MessageCircle,
  retweet_count: Repeat2,
  quote_count: Quote,
  play_count: Play,
  digg_count: ThumbsUp,
  comment_count: MessageCircle,
  share_count: Share2,
  collect_count: Bookmark,
};

export function renderMetricChips(
  metrics: Record<string, number | undefined>,
  limit?: number,
) {
  const entries = Object.entries(metrics)
    .filter(([, v]) => v != null && v > 0)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0));

  const visible = limit ? entries.slice(0, limit) : entries;

  return visible.map(([key, value]) => {
    const Icon = METRIC_ICON[key as EngagementMetricKey] ?? Eye;
    return (
      <span
        key={key}
        className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground"
      >
        <Icon className="h-2.5 w-2.5" />
        {formatCount(value ?? 0)}
      </span>
    );
  });
}
