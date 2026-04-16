"use client";

/**
 * CartographyLayout — Full-page layout for the avatar packed bubble chart.
 *
 * Composes the toolbar, bubble chart, stats panel, tooltip, and detail panel.
 */

import { useState, useCallback, useEffect, memo } from "react";
import { RotateCw, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PackedBubbleChart } from "./packed-bubble-chart";
import { ClusterToolbar } from "./cluster-toolbar";
import { ClusterStatsPanel } from "./cluster-stats-panel";
import { AvatarTooltip } from "./avatar-tooltip";
import { AvatarDetailPanel } from "./avatar-detail-panel";
import type {
  CartographyData,
  ConstellationNode,
  ClusterDimension,
  ClusterGroup,
} from "@/types/cartography";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CartographyLayoutProps {
  data: CartographyData;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CartographyLayout = memo(function CartographyLayout({
  data,
}: CartographyLayoutProps) {
  const [dimension, setDimension] = useState<ClusterDimension>(
    data.availableDimensions[0] ?? "identity"
  );
  const [hoveredNode, setHoveredNode] = useState<ConstellationNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<ConstellationNode | null>(null);
  const [clusters, setClusters] = useState<ClusterGroup[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [focusedCluster, setFocusedCluster] = useState<string | null>(null);

  // Reset focused cluster when dimension changes
  useEffect(() => {
    setFocusedCluster(null);
  }, [dimension]);

  // If current dimension becomes unavailable, fallback
  useEffect(() => {
    if (
      data.availableDimensions.length > 0 &&
      !data.availableDimensions.includes(dimension)
    ) {
      setDimension(data.availableDimensions[0]);
    }
  }, [data.availableDimensions, dimension]);

  const handleNodeHover = useCallback(
    (node: ConstellationNode | null, x: number, y: number) => {
      setHoveredNode(node);
      setTooltipPos({ x, y });
    },
    []
  );

  const handleNodeClick = useCallback(
    (node: ConstellationNode | null) => {
      setSelectedNode((prev) =>
        prev?.id === node?.id ? null : node
      );
    },
    []
  );

  const handleClustersReady = useCallback((c: ClusterGroup[]) => {
    setClusters(c);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = document.getElementById("cartography-root");
    if (!el) return;

    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  if (data.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex flex-col items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <RotateCw className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-body-sm font-medium text-foreground">
            No avatars yet
          </p>
          <p className="text-caption normal-case">
            Create avatars in the Operator to see them mapped here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      id="cartography-root"
      className={cn(
        "relative flex h-full flex-col overflow-hidden",
        isFullscreen && "bg-background"
      )}
    >
      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 border-b border-border/40 px-4 py-2 glass-effect">
        <div className="flex items-center gap-3">
          <h2 className="text-caption normal-case tracking-wider">
            Cartography
          </h2>
          <Badge
            variant="secondary"
            className="text-[10px] font-normal tabular-nums"
          >
            {data.totalAvatars} avatars · {data.totalArmies} armies · {data.totalCampaigns} campaigns
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <ClusterToolbar
            active={dimension}
            availableDimensions={data.availableDimensions}
            onChange={setDimension}
          />

          <span className="h-5 w-px bg-border" />

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={toggleFullscreen}
                />
              }
            >
              {isFullscreen ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Main content: chart + stats sidebar */}
      <div className="flex flex-1 pt-[45px]">
        {/* Bubble chart */}
        <div className="flex-1">
          <PackedBubbleChart
            nodes={data.nodes}
            dimension={dimension}
            onNodeHover={handleNodeHover}
            onNodeClick={handleNodeClick}
            onClustersReady={handleClustersReady}
            focusedCluster={focusedCluster}
          />
        </div>

        {/* Stats panel */}
        <ClusterStatsPanel
          clusters={clusters}
          totalAvatars={data.totalAvatars}
          totalArmies={data.totalArmies}
          totalCampaigns={data.totalCampaigns}
          focusedCluster={focusedCluster}
          onClusterFocus={setFocusedCluster}
        />
      </div>

      {/* Hover tooltip */}
      <AvatarTooltip
        node={hoveredNode}
        x={tooltipPos.x}
        y={tooltipPos.y}
      />

      {/* Detail panel */}
      {selectedNode && (
        <AvatarDetailPanel
          node={selectedNode}
          dimension={dimension}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
});
