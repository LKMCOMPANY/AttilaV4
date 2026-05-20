"use client";

/**
 * Campaign Network Map — orchestrator.
 *
 * Coordinates the data fetch, filter state, fullscreen + selection
 * lifecycle and composes three sub-modules:
 *
 *   - `network-graph-3d`  → WebGL canvas + camera + handlers
 *   - `network-filters`   → filter popover + legend
 *   - `network-theme`     → OKLCH-derived hex palette
 *
 * Visualises the interaction network for a single campaign:
 *   CENTER — Zone target (Gorgone zone)
 *   MIDDLE — Source posts
 *   OUTER  — Avatars
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTheme } from "next-themes";
import { Maximize2, Minimize2, RotateCw, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { NetworkMapSkeleton } from "./network-map-skeleton";
import { NetworkNodeDetails } from "./network-node-details";
import { NetworkFilters, NetworkLegend } from "./network-filters";
import {
  NetworkGraph3D,
  type NetworkGraph3DHandle,
} from "./network-graph-3d";
import { NETWORK_THEME } from "./network-theme";
import { useNetworkData } from "./use-network-data";
import type {
  NetworkData,
  NetworkLink,
  NetworkNode,
  NetworkNodeFilters,
  NetworkStatusFilters,
} from "@/types/network";

interface CampaignNetworkMapProps {
  campaignId: string;
  pipelineVersion?: number;
  className?: string;
}

export const CampaignNetworkMap = memo(function CampaignNetworkMap({
  campaignId,
  pipelineVersion,
  className,
}: CampaignNetworkMapProps) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? NETWORK_THEME.dark : NETWORK_THEME.light;

  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<NetworkGraph3DHandle>(null);

  // Data lifecycle is owned by `useNetworkData`: initial load, realtime
  // refresh on `pipelineVersion` ticks, and a 2-minute fallback poll.
  const { data, isLoading, isFetching, error, refresh } = useNetworkData(
    campaignId,
    pipelineVersion,
  );

  // UI state
  const [selectedNode, setSelectedNode] = useState<NetworkNode | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Filters
  const [nodeFilters, setNodeFilters] = useState<NetworkNodeFilters>({
    zoneTargets: true,
    sourcePosts: true,
    avatars: true,
  });
  const [statusFilters, setStatusFilters] = useState<NetworkStatusFilters>({
    done: true,
    failed: true,
    pending: true,
  });

  // NOTE: `selectedNode` is reset on campaign change via the parent
  // (`campaign-center-panel.tsx`) which mounts this component with
  // `key={campaign.id}`. That's the React 19 idiomatic way — an effect
  // calling `setSelectedNode(null)` would cascade re-renders and trips
  // the `react-hooks/set-state-in-effect` lint.

  // ---- Filtered graph data ------------------------------------------

  const filteredData = useMemo(() => filterGraph(data, nodeFilters, statusFilters), [
    data,
    nodeFilters,
    statusFilters,
  ]);

  // ---- Container dimensions (ResizeObserver) ------------------------

  useEffect(() => {
    if (isLoading || !data) return;
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setDimensions({ width: rect.width, height: rect.height });
      }
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isLoading, data, isFullscreen]);

  // ---- Handlers -----------------------------------------------------

  const handleNodeClick = useCallback((node: NetworkNode) => {
    setSelectedNode((prev) => (prev?.id === node.id ? null : node));
    graphRef.current?.focusNode(node);
  }, []);

  const handleResetCamera = useCallback(() => {
    graphRef.current?.resetCamera();
    setSelectedNode(null);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
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

  // ---- Loading / error / empty states -------------------------------

  if (isLoading) return <NetworkMapSkeleton className={className} />;

  if (error) {
    return (
      <div className={cn("flex h-full items-center justify-center p-8", className)}>
        <div className="text-center">
          <p className="text-body-sm text-muted-foreground">
            Failed to load network data
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={refresh}
          >
            <RotateCw className="mr-1.5 h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className={cn("flex h-full items-center justify-center p-8", className)}>
        <div className="flex flex-col items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <Target className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-body-sm font-medium text-foreground">No network data</p>
          <p className="text-caption normal-case">
            Posts and responses will appear as the campaign runs
          </p>
        </div>
      </div>
    );
  }

  // ---- Render -------------------------------------------------------

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-full w-full overflow-hidden",
        "transition-all duration-[var(--transition-base)]",
        isFullscreen && "rounded-none",
        className,
      )}
    >
      {/* Header overlay */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-border/40 p-2.5 glass-effect">
        <div className="flex items-center gap-2">
          <h3 className="text-caption normal-case tracking-wider">Campaign Map</h3>
          <Badge variant="secondary" className="text-[10px] font-normal tabular-nums">
            {data.stats.totalPosts} posts · {data.stats.totalAvatars} avatars
          </Badge>
          {isFetching && (
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"
              aria-label="Refreshing"
            />
          )}
        </div>

        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleResetCamera}
                />
              }
            >
              <RotateCw className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Center View
            </TooltipContent>
          </Tooltip>

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

          <NetworkFilters
            nodeFilters={nodeFilters}
            statusFilters={statusFilters}
            onNodeFiltersChange={setNodeFilters}
            onStatusFiltersChange={setStatusFilters}
          />
        </div>
      </div>

      {/* WebGL canvas */}
      <div
        className="h-full w-full"
        style={{
          background: `radial-gradient(ellipse at center, ${theme.bgCenter} 0%, ${theme.bgEdge} 100%)`,
        }}
      >
        <NetworkGraph3D
          ref={graphRef}
          nodes={filteredData.nodes}
          links={filteredData.links}
          width={dimensions.width}
          height={dimensions.height}
          theme={theme}
          isFocused={selectedNode !== null}
          onNodeClick={handleNodeClick}
        />
      </div>

      <NetworkLegend />

      {selectedNode && (
        <NetworkNodeDetails
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Pure helpers — kept module-local so the orchestrator stays slim.
// ---------------------------------------------------------------------------

/**
 * Apply node-type and job-status filters to the graph dataset:
 *   1. drop reply_to links whose status is filtered out,
 *   2. drop disabled node types,
 *   3. prune avatars that lost all their visible links,
 *   4. drop links whose endpoints were removed.
 */
function filterGraph(
  data: NetworkData | null,
  nodeFilters: NetworkNodeFilters,
  statusFilters: NetworkStatusFilters,
): { nodes: NetworkNode[]; links: NetworkLink[] } {
  if (!data) return { nodes: [], links: [] };

  const links = data.links.filter((l) => {
    if (l.type !== "reply_to" || !l.status) return true;
    if (l.status === "done" && !statusFilters.done) return false;
    if (l.status === "failed" && !statusFilters.failed) return false;
    if (l.status === "pending" && !statusFilters.pending) return false;
    return true;
  });

  const linkedAvatarIds = new Set<string>();
  for (const l of links) {
    const src = resolveEndpointId(l.source);
    if (src && src.startsWith("av_")) linkedAvatarIds.add(src);
  }

  const nodes = data.nodes.filter((n) => {
    if (n.type === "zone_target" && !nodeFilters.zoneTargets) return false;
    if (n.type === "source_post" && !nodeFilters.sourcePosts) return false;
    if (n.type === "avatar") {
      if (!nodeFilters.avatars) return false;
      if (!linkedAvatarIds.has(n.id)) return false;
    }
    return true;
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const validLinks = links.filter((l) => {
    const src = resolveEndpointId(l.source);
    const tgt = resolveEndpointId(l.target);
    return src !== null && tgt !== null && nodeIds.has(src) && nodeIds.has(tgt);
  });

  return { nodes, links: validLinks };
}

/**
 * Endpoints in `react-force-graph-3d` data are strings on first load
 * and get replaced by full node objects after the first simulation
 * tick. Read either shape into a stable string id.
 */
function resolveEndpointId(endpoint: NetworkLink["source"]): string | null {
  if (typeof endpoint === "string") return endpoint;
  if (endpoint && typeof endpoint === "object" && "id" in endpoint) {
    const id = (endpoint as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}
