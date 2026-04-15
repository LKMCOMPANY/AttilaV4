"use client";

import { memo } from "react";
import {
  ExternalLink,
  X,
  MessageSquare,
  User,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { NetworkNode } from "@/types/network";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NetworkNodeDetailsProps {
  node: NetworkNode;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Status map
// ---------------------------------------------------------------------------

const POST_STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending", variant: "secondary" },
  processing: { label: "Processing", variant: "outline" },
  responded: { label: "Responded", variant: "default" },
  filtered_out: { label: "Filtered", variant: "outline" },
  error: { label: "Error", variant: "destructive" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const NetworkNodeDetails = memo(function NetworkNodeDetails({
  node,
  onClose,
}: NetworkNodeDetailsProps) {
  const isZoneTarget = node.type === "zone_target";
  const isSourcePost = node.type === "source_post";
  const isAvatar = node.type === "avatar";

  const iconConfig = isZoneTarget
    ? { Icon: Target, bg: "bg-foreground/10", fg: "text-foreground" }
    : isSourcePost
      ? { Icon: MessageSquare, bg: "bg-muted", fg: "text-muted-foreground" }
      : { Icon: User, bg: "bg-primary/15", fg: "text-primary" };

  const typeLabel = isZoneTarget
    ? "Zone Target"
    : isSourcePost
      ? "Source Post"
      : "Avatar";

  const openExternal = (url: string) =>
    window.open(url, "_blank", "noopener,noreferrer");

  const twitterProfileUrl = node.metadata?.twitterHandle
    ? `https://x.com/${node.metadata.twitterHandle.replace(/^@/, "")}`
    : null;

  return (
    <div
      className={cn(
        "absolute bottom-12 left-3 right-3 md:left-auto md:right-3 md:w-72",
        "glass-effect rounded-lg border shadow-lg",
        "animate-in fade-in slide-in-from-bottom-5 duration-200"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between border-b p-3 pb-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          {isAvatar && node.metadata?.profileImageUrl ? (
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarImage
                src={node.metadata.profileImageUrl}
                alt={node.label}
              />
              <AvatarFallback>
                {node.label.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          ) : (
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                iconConfig.bg
              )}
            >
              <iconConfig.Icon className={cn("h-4 w-4", iconConfig.fg)} />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{node.label}</p>
            <p className="text-[11px] text-muted-foreground">{typeLabel}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
          <span className="sr-only">Close</span>
        </Button>
      </div>

      {/* Body */}
      <div className="space-y-2 p-3">
        {/* Zone target */}
        {isZoneTarget && (
          <>
            <DetailRow label="Zone" value={node.metadata?.zoneName} />
            <DetailRow label="Campaign" value={node.metadata?.campaignName} />
          </>
        )}

        {/* Source post */}
        {isSourcePost && (
          <>
            {node.metadata?.status && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  Status
                </span>
                <Badge
                  variant={
                    POST_STATUS_LABELS[node.metadata.status]?.variant ??
                    "secondary"
                  }
                  className="text-[10px]"
                >
                  {POST_STATUS_LABELS[node.metadata.status]?.label ??
                    node.metadata.status}
                </Badge>
              </div>
            )}
            <DetailRow label="Author" value={node.metadata?.authorUsername ? `@${node.metadata.authorUsername}` : undefined} />
            <DetailRow
              label="Engagement"
              value={node.metadata?.engagementCount?.toLocaleString()}
            />
            <DetailRow
              label="Responses"
              value={node.metadata?.responseCount?.toString()}
            />
            {node.metadata?.postText && (
              <p className="line-clamp-3 text-[11px] text-muted-foreground">
                {node.metadata.postText}
              </p>
            )}
          </>
        )}

        {/* Avatar */}
        {isAvatar && (
          <>
            <DetailRow label="Handle" value={node.metadata?.twitterHandle ? `@${node.metadata.twitterHandle}` : undefined} />
            <DetailRow
              label="Responses"
              value={node.metadata?.responseCount?.toString()}
            />
          </>
        )}
      </div>

      {/* Actions — only render when there are actionable links */}
      {((isSourcePost && node.metadata?.postUrl) ||
        ((isAvatar || isZoneTarget) && twitterProfileUrl)) && (
        <div className="flex gap-2 border-t p-3 pt-2.5">
          {isSourcePost && node.metadata?.postUrl && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5 text-[11px]"
              onClick={() => openExternal(node.metadata!.postUrl!)}
            >
              <ExternalLink className="h-3 w-3" />
              View Post
            </Button>
          )}
          {(isAvatar || isZoneTarget) && twitterProfileUrl && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5 text-[11px]"
              onClick={() => openExternal(twitterProfileUrl)}
            >
              <ExternalLink className="h-3 w-3" />
              View Profile
            </Button>
          )}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Shared detail row
// ---------------------------------------------------------------------------

function DetailRow({
  label,
  value,
}: {
  label: string;
  value?: string;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
}
