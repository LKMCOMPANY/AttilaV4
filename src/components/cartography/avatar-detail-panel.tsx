"use client";

/**
 * AvatarDetailPanel — Slide-in panel showing full avatar details
 * when a constellation node is clicked.
 */

import { memo } from "react";
import {
  X,
  Globe,
  Shield,
  Brain,
  UserCog,
  Zap,
  Share2,
  Smartphone,
  Calendar,
} from "lucide-react"; // All used directly in DetailSection icons
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConstellationNode, ClusterDimension } from "@/types/cartography";
import { DIMENSION_ICONS } from "./constants";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AvatarDetailPanelProps {
  node: ConstellationNode;
  dimension: ClusterDimension;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Status badge styling
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  active: "bg-success/10 text-success border-success/20",
  inactive: "bg-muted text-muted-foreground border-border",
  suspended: "bg-destructive/10 text-destructive border-destructive/20",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AvatarDetailPanel = memo(function AvatarDetailPanel({
  node,
  dimension,
  onClose,
}: AvatarDetailPanelProps) {
  const { avatar } = node;

  const platforms = [
    avatar.twitterEnabled && "Twitter / X",
    avatar.tiktokEnabled && "TikTok",
    avatar.redditEnabled && "Reddit",
    avatar.instagramEnabled && "Instagram",
  ].filter(Boolean) as string[];

  const createdDate = new Date(avatar.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div
      className={cn(
        "absolute right-0 top-0 z-20 flex h-full w-80 flex-col",
        "border-l bg-card/95 backdrop-blur-md",
        "animate-in slide-in-from-right duration-200"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2.5">
          {avatar.profileImageUrl ? (
            <img
              src={avatar.profileImageUrl}
              alt=""
              className="h-8 w-8 rounded-full object-cover ring-1 ring-border"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
              {avatar.firstName[0]}{avatar.lastName[0]}
            </div>
          )}
          <div>
            <p className="text-body-sm font-medium leading-tight">
              {avatar.firstName} {avatar.lastName}
            </p>
            <Badge
              variant="outline"
              className={cn(
                "mt-0.5 text-[10px] font-normal",
                STATUS_STYLES[avatar.status]
              )}
            >
              {avatar.status}
            </Badge>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-5">
        {/* Current cluster */}
        <DetailSection
          label="Current Cluster"
          icon={DIMENSION_ICONS[dimension]}
        >
          <p className="text-body-sm">{node.clusters[dimension]}</p>
        </DetailSection>

        {/* Identity */}
        <DetailSection label="Identity" icon={Globe}>
          <div className="grid grid-cols-2 gap-2">
            <DataPoint label="Country" value={avatar.countryCode.toUpperCase()} />
            <DataPoint label="Language" value={avatar.languageCode.toUpperCase()} />
          </div>
        </DetailSection>

        {/* Personality */}
        <DetailSection label="Personality" icon={Brain}>
          <div className="grid grid-cols-2 gap-2">
            <DataPoint label="Style" value={capitalize(avatar.writingStyle)} />
            <DataPoint label="Tone" value={capitalize(avatar.tone)} />
            <DataPoint label="Vocabulary" value={capitalize(avatar.vocabularyLevel)} />
            <DataPoint label="Emoji" value={capitalize(avatar.emojiUsage)} />
          </div>
          {avatar.personalityTraits.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {avatar.personalityTraits.map((trait) => (
                <Badge
                  key={trait}
                  variant="secondary"
                  className="text-[10px] font-normal"
                >
                  {trait}
                </Badge>
              ))}
            </div>
          )}
        </DetailSection>

        {/* Armies */}
        <DetailSection label="Armies" icon={Shield}>
          {avatar.armies.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">Unassigned</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {avatar.armies.map((a) => (
                <Badge
                  key={a.id}
                  variant="outline"
                  className="text-[10px] font-normal"
                >
                  {a.name}
                </Badge>
              ))}
            </div>
          )}
        </DetailSection>

        {/* Operators */}
        <DetailSection label="Operators" icon={UserCog}>
          {avatar.operators.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">No operators assigned</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {avatar.operators.map((op) => (
                <Badge
                  key={op.id}
                  variant="secondary"
                  className="text-[10px] font-normal"
                >
                  {op.name}
                </Badge>
              ))}
            </div>
          )}
        </DetailSection>

        {/* Platforms */}
        <DetailSection label="Platforms" icon={Share2}>
          {platforms.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">No platforms enabled</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {platforms.map((p) => (
                <Badge
                  key={p}
                  variant="outline"
                  className="text-[10px] font-normal"
                >
                  {p}
                </Badge>
              ))}
            </div>
          )}
        </DetailSection>

        {/* Usage metrics */}
        <DetailSection label="Activity" icon={Zap}>
          <div className="grid grid-cols-2 gap-2">
            <DataPoint
              label="Automator jobs"
              value={node.automatorJobs.toString()}
            />
            <DataPoint
              label="Success rate"
              value={
                node.automatorJobs > 0
                  ? `${Math.round(node.automatorSuccessRate * 100)}%`
                  : "—"
              }
            />
            <DataPoint
              label="Content items"
              value={node.contentItemCount.toString()}
            />
            <DataPoint
              label="Operators"
              value={node.operatorCount.toString()}
            />
          </div>
        </DetailSection>

        {/* Device */}
        <DetailSection label="Device" icon={Smartphone}>
          <p className="text-body-sm">
            {avatar.deviceId
              ? `Assigned · ${capitalize(avatar.deviceState ?? "unknown")}`
              : "No device assigned"}
          </p>
        </DetailSection>

        {/* Tags */}
        {avatar.tags.length > 0 && (
          <DetailSection label="Tags" icon={Shield}>
            <div className="flex flex-wrap gap-1">
              {avatar.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="text-[10px] font-normal"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </DetailSection>
        )}

        {/* Created */}
        <DetailSection label="Created" icon={Calendar}>
          <p className="text-body-sm text-muted-foreground">{createdDate}</p>
        </DetailSection>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DetailSection({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-caption">{label}</span>
      </div>
      {children}
    </div>
  );
}

function DataPoint({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-body-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
