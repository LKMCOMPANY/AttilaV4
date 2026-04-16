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
  Reply,
} from "lucide-react";
import { PostStatusBadge } from "./pipeline-status";
import { SocialIcon } from "@/components/icons/social-icons";
import { formatDistanceToNow } from "date-fns";
import type {
  CampaignPost,
  CampaignJobWithAvatar,
  SocialPlatform,
} from "@/types";

// ---------------------------------------------------------------------------
// Post row — compact list item, click opens detail overlay
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
  const doneResponses = responses.filter((r) => r.status === "done");
  const sourceScreenshot = responses.find(
    (r) => r.source_screenshot
  )?.source_screenshot;

  return (
    <button
      onClick={onSelect}
      className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted/50"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-snug">
          {post.post_author && (
            <span className="text-primary">@{post.post_author} </span>
          )}
          <span className="truncate-multiline truncate-2 text-foreground">
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
          <PostStatusBadge status={post.status} />
          <span>
            {formatDistanceToNow(new Date(post.created_at), {
              addSuffix: true,
            })}
          </span>
        </div>

        {/* Metrics + response count */}
        <div className="mt-1.5 flex items-center gap-2">
          {hasMetrics && (
            <div className="flex flex-wrap gap-1">
              {renderMetricChips(metrics, 3)}
            </div>
          )}
          {responses.length > 0 && (
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
              <Reply className="h-2.5 w-2.5" />
              {doneResponses.length}/{responses.length}
            </span>
          )}
        </div>
      </div>

      {/* Source screenshot thumbnail */}
      {sourceScreenshot && (
        <div className="aspect-[9/16] w-7 shrink-0 overflow-hidden rounded border border-border/40">
          <img
            src={sourceScreenshot}
            alt={`Source: ${post.post_author ?? "post"}`}
            className="h-full w-full object-cover"
          />
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Metric chips
// ---------------------------------------------------------------------------

const METRIC_ICON: Record<string, typeof Eye> = {
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
  limit?: number
) {
  const entries = Object.entries(metrics)
    .filter(([, v]) => v != null && v > 0)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0));

  const visible = limit ? entries.slice(0, limit) : entries;

  return visible.map(([key, value]) => {
    const Icon = METRIC_ICON[key] ?? Eye;
    return (
      <span
        key={key}
        className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[9px] tabular-nums text-muted-foreground"
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

