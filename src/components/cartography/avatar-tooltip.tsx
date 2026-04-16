"use client";

/**
 * AvatarTooltip — Floating tooltip shown on hover over a bubble chart node.
 */

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { ConstellationNode } from "@/types/cartography";

interface AvatarTooltipProps {
  node: ConstellationNode | null;
  x: number;
  y: number;
}

export const AvatarTooltip = memo(function AvatarTooltip({
  node,
  x,
  y,
}: AvatarTooltipProps) {
  if (!node) return null;

  const platforms = [
    node.avatar.twitterEnabled && "X",
    node.avatar.tiktokEnabled && "TikTok",
    node.avatar.redditEnabled && "Reddit",
    node.avatar.instagramEnabled && "IG",
  ].filter(Boolean);

  return (
    <div
      className={cn(
        "pointer-events-none fixed z-[var(--z-tooltip)]",
        "rounded-lg border bg-popover/95 px-3 py-2.5 shadow-lg backdrop-blur-sm",
        "animate-in fade-in-0 zoom-in-95 duration-100"
      )}
      style={{
        left: x + 14,
        top: y - 10,
      }}
    >
      <div className="flex items-center gap-2.5">
        {node.profileImageUrl ? (
          <img
            src={node.profileImageUrl}
            alt=""
            className="h-7 w-7 rounded-full object-cover ring-1 ring-border"
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
            {node.avatar.firstName[0]}
            {node.avatar.lastName[0]}
          </div>
        )}
        <div>
          <p className="text-body-sm font-medium leading-tight">{node.label}</p>
          <p className="text-[10px] text-muted-foreground">
            {node.avatar.countryCode.toUpperCase()} ·{" "}
            {node.avatar.status}
            {platforms.length > 0 && ` · ${platforms.join(", ")}`}
          </p>
        </div>
      </div>

      {(node.automatorJobs > 0 || node.operatorCount > 0) && (
        <div className="mt-1.5 flex gap-3 border-t border-border/50 pt-1.5">
          {node.automatorJobs > 0 && (
            <span className="text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums">
                {node.automatorJobs}
              </span>{" "}
              jobs
            </span>
          )}
          {node.operatorCount > 0 && (
            <span className="text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums">
                {node.operatorCount}
              </span>{" "}
              ops
            </span>
          )}
          {node.armyCount > 0 && (
            <span className="text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums">
                {node.armyCount}
              </span>{" "}
              {node.armyCount === 1 ? "army" : "armies"}
            </span>
          )}
        </div>
      )}
    </div>
  );
});
