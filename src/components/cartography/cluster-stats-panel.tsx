"use client";

/**
 * ClusterStatsPanel — Sidebar showing cluster distribution for the active
 * dimension, with interactive bars that zoom the bubble chart on click.
 */

import { memo } from "react";
import { Shield, Users, Crosshair } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClusterGroup } from "@/types/cartography";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ClusterStatsPanelProps {
  clusters: ClusterGroup[];
  totalAvatars: number;
  totalArmies: number;
  totalCampaigns: number;
  focusedCluster: string | null;
  onClusterFocus: (key: string | null) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ClusterStatsPanel = memo(function ClusterStatsPanel({
  clusters,
  totalAvatars,
  totalArmies,
  totalCampaigns,
  focusedCluster,
  onClusterFocus,
  className,
}: ClusterStatsPanelProps) {
  const maxCount = Math.max(...clusters.map((c) => c.nodeCount), 1);

  return (
    <div
      className={cn(
        "flex w-60 flex-col border-l border-border/40 glass-effect",
        className
      )}
    >
      {/* Header */}
      <div className="border-b border-border/40 px-4 py-3">
        <h3 className="text-caption normal-case tracking-wider">
          Distribution
        </h3>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {clusters.length} cluster{clusters.length !== 1 ? "s" : ""} · {totalAvatars} avatars
        </p>
      </div>

      {/* Cluster list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-1.5">
        {clusters.map((cluster) => {
          const pct = totalAvatars > 0
            ? Math.round((cluster.nodeCount / totalAvatars) * 100)
            : 0;
          const barWidth = (cluster.nodeCount / maxCount) * 100;
          const isFocused = focusedCluster === cluster.key;

          return (
            <button
              key={cluster.key}
              type="button"
              onClick={() =>
                onClusterFocus(isFocused ? null : cluster.key)
              }
              className={cn(
                "group w-full rounded-md px-2.5 py-2 text-left transition-colors",
                "hover:bg-accent/50",
                isFocused && "bg-accent/60 ring-1 ring-primary/30"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: cluster.color }}
                  />
                  <span className="truncate text-body-sm">
                    {cluster.label}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {pct}%
                  </span>
                  <span className="text-body-sm font-medium tabular-nums">
                    {cluster.nodeCount}
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted/50">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${barWidth}%`,
                    backgroundColor: cluster.color,
                    opacity: isFocused ? 1 : 0.7,
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Summary footer */}
      <div className="border-t border-border/40 px-4 py-3 space-y-2">
        <SummaryRow icon={Users} label="Avatars" value={totalAvatars} />
        <SummaryRow icon={Shield} label="Armies" value={totalArmies} />
        <SummaryRow icon={Crosshair} label="Campaigns" value={totalCampaigns} />
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-component
// ---------------------------------------------------------------------------

function SummaryRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
      <span className="text-body-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}
