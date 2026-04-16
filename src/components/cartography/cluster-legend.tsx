"use client";

/**
 * ClusterLegend — Dynamic legend showing active cluster groups
 * with dot colors and node counts.
 */

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { ClusterGroup } from "@/types/cartography";

interface ClusterLegendProps {
  clusters: ClusterGroup[];
  totalNodes: number;
  className?: string;
}

export const ClusterLegend = memo(function ClusterLegend({
  clusters,
  totalNodes,
  className,
}: ClusterLegendProps) {
  if (clusters.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5",
        className
      )}
    >
      {clusters.map((cluster) => (
        <div key={cluster.key} className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: cluster.color }}
          />
          <span className="text-[10px] text-muted-foreground">
            {cluster.label}
          </span>
          <span className="text-[10px] font-medium tabular-nums text-foreground/60">
            {cluster.nodeCount}
          </span>
        </div>
      ))}

      <span className="h-3 w-px bg-border" />

      <span className="text-[10px] tabular-nums text-muted-foreground">
        {totalNodes} avatars
      </span>
    </div>
  );
});
