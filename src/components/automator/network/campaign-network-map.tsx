"use client";

/**
 * Campaign Network Map — 3D Force-Directed Graph
 *
 * Visualises the interaction network for a single campaign:
 *   CENTER — Zone target (Gorgone zone)
 *   MIDDLE — Source posts
 *   OUTER  — Avatars
 *
 * Uses react-force-graph-3d (Three.js) with auto-rotation, click-to-zoom,
 * node filters and a detail panel. Colors derive from the design system
 * OKLCH palette via resolved CSS variables.
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  memo,
} from "react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import {
  RotateCw,
  Maximize2,
  Minimize2,
  Filter,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { getNetworkData } from "@/app/actions/network";
import { NetworkMapSkeleton } from "./network-map-skeleton";
import { NetworkNodeDetails } from "./network-node-details";
import type {
  NetworkData,
  NetworkNode,
  NetworkLink,
  NetworkNodeFilters,
  NetworkStatusFilters,
  NetworkJobStatus,
} from "@/types/network";

// ---------------------------------------------------------------------------
// Dynamic import — WebGL must be client-only
// ---------------------------------------------------------------------------

const ForceGraph3D = dynamic(
  () => import("react-force-graph-3d").then((mod) => mod.default),
  { ssr: false, loading: () => <NetworkMapSkeleton /> }
);

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CampaignNetworkMapProps {
  campaignId: string;
  pipelineVersion?: number;
  className?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FALLBACK_POLL_INTERVAL = 120_000;
const CAMERA_DISTANCE = 350;
const ROTATION_SPEED = 0.0002;

// ---------------------------------------------------------------------------
// Design system palette — hex equivalents of the OKLCH tokens in globals.css.
// Three.js/WebGL cannot consume CSS variables or oklch(); hardcoded hex
// values are the industry-standard approach for WebGL color theming.
//
// Dark primary  oklch(0.70 0.09 96) → #b8a46c
// Light primary oklch(0.50 0.07 96) → #6e6230
// Dark destr.   oklch(0.60 0.22 25) → #e05252
// Light destr.  oklch(0.577 0.245 27.325) → #dc2626
// ---------------------------------------------------------------------------

const THEME_COLORS = {
  dark: {
    zoneTarget: "#f5f0e8",
    sourcePost: "#8a8578",
    avatar: "#b8a46c",
    mentionLink: "#3d3a33",
    completedLink: "#b8a46c",
    failedLink: "#e05252",
    pendingLink: "#4a4740",
    bgCenter: "#1f1d19",
    bgEdge: "#15140f",
  },
  light: {
    zoneTarget: "#1a1814",
    sourcePost: "#78756e",
    avatar: "#6e6230",
    mentionLink: "#d6d3cc",
    completedLink: "#6e6230",
    failedLink: "#dc2626",
    pendingLink: "#a8a49c",
    bgCenter: "#faf9f7",
    bgEdge: "#f0eee9",
  },
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CampaignNetworkMap = memo(function CampaignNetworkMap({
  campaignId,
  pipelineVersion,
  className,
}: CampaignNetworkMapProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const colors = isDark ? THEME_COLORS.dark : THEME_COLORS.light;

  // Refs
  const fgRef = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);

  // Data state
  const [data, setData] = useState<NetworkData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);

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

  // ---------- Data fetching (realtime-triggered + fallback poll) ----------

  const fetchData = useCallback(
    async (initial = false) => {
      if (initial) setIsLoading(true);
      else setIsFetching(true);

      const result = await getNetworkData(campaignId);

      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setData(result.data);
        setError(null);
      }

      if (initial) setIsLoading(false);
      else setIsFetching(false);
    },
    [campaignId]
  );

  // Initial load
  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  // Realtime-triggered refresh
  useEffect(() => {
    if (pipelineVersion && pipelineVersion > 0) fetchData(false);
  }, [pipelineVersion, fetchData]);

  // Long-interval fallback poll (safety net)
  useEffect(() => {
    const interval = setInterval(() => fetchData(false), FALLBACK_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Reset selection when campaign changes
  useEffect(() => {
    setSelectedNode(null);
  }, [campaignId]);

  // ---------- Filtered graph data ----------------------------------------

  const filteredData = useMemo(() => {
    if (!data) return { nodes: [], links: [] };

    // 1 — Filter links by job status (reply_to links carry a status)
    const links = data.links.filter((l) => {
      if (l.type === "reply_to" && l.status) {
        if (l.status === "done" && !statusFilters.done) return false;
        if (l.status === "failed" && !statusFilters.failed) return false;
        if (l.status === "pending" && !statusFilters.pending) return false;
      }
      return true;
    });

    // 2 — Collect avatar IDs that still have at least one visible link
    const linkedAvatarIds = new Set<string>();
    for (const l of links) {
      const src = typeof l.source === "object" ? (l.source as any).id : l.source; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (typeof src === "string" && src.startsWith("av_")) linkedAvatarIds.add(src);
    }

    // 3 — Filter nodes by type toggles + orphaned avatar pruning
    const nodes = data.nodes.filter((n) => {
      if (n.type === "zone_target" && !nodeFilters.zoneTargets) return false;
      if (n.type === "source_post" && !nodeFilters.sourcePosts) return false;
      if (n.type === "avatar") {
        if (!nodeFilters.avatars) return false;
        if (!linkedAvatarIds.has(n.id)) return false;
      }
      return true;
    });

    // 4 — Drop links whose endpoints were removed
    const nodeIds = new Set(nodes.map((n) => n.id));
    const validLinks = links.filter((l) => {
      const src = typeof l.source === "object" ? (l.source as any).id : l.source; // eslint-disable-line @typescript-eslint/no-explicit-any
      const tgt = typeof l.target === "object" ? (l.target as any).id : l.target; // eslint-disable-line @typescript-eslint/no-explicit-any
      return nodeIds.has(src) && nodeIds.has(tgt);
    });

    return { nodes, links: validLinks };
  }, [data, nodeFilters, statusFilters]);

  // ---------- Container dimensions (ResizeObserver) ----------------------

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

  // ---------- Camera controls --------------------------------------------

  const resetCamera = useCallback(() => {
    if (!fgRef.current) return;
    fgRef.current.cameraPosition(
      { x: 0, y: 0, z: CAMERA_DISTANCE },
      { x: 0, y: 0, z: 0 },
      800
    );
    setSelectedNode(null);
  }, []);

  useEffect(() => {
    if (data && data.nodes.length > 0 && fgRef.current) {
      const t = setTimeout(resetCamera, 500);
      return () => clearTimeout(t);
    }
  }, [data, resetCamera]);

  // Auto-rotation
  useEffect(() => {
    if (!fgRef.current || selectedNode) return;
    let angle = 0;

    const animate = () => {
      if (!fgRef.current || selectedNode) {
        animationRef.current = null;
        return;
      }
      angle += ROTATION_SPEED;
      const x = CAMERA_DISTANCE * Math.sin(angle);
      const z = CAMERA_DISTANCE * Math.cos(angle);
      const y = 30 * Math.sin(angle * 0.4);

      const cam = fgRef.current.camera();
      if (cam) {
        const p = cam.position;
        const e = 0.003;
        fgRef.current.cameraPosition(
          { x: p.x + (x - p.x) * e, y: p.y + (y - p.y) * e, z: p.z + (z - p.z) * e },
          { x: 0, y: 0, z: 0 },
          0
        );
      }
      animationRef.current = requestAnimationFrame(animate);
    };

    const t = setTimeout(() => {
      animationRef.current = requestAnimationFrame(animate);
    }, 1500);

    return () => {
      clearTimeout(t);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [selectedNode]);

  // ---------- Handlers ---------------------------------------------------

  const handleNodeClick = useCallback((node: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const typed = node as NetworkNode;
    setSelectedNode((prev) => (prev?.id === typed.id ? null : typed));

    if (fgRef.current) {
      const dist = typed.type === "zone_target" ? 180 : 100;
      const pos = { x: typed.x ?? 0, y: typed.y ?? 0, z: typed.z ?? 0 };
      const r = Math.hypot(pos.x, pos.y, pos.z) || 1;
      const ratio = 1 + dist / r;

      fgRef.current.cameraPosition(
        { x: pos.x * ratio || 0, y: pos.y * ratio || 40, z: pos.z * ratio || dist },
        typed,
        800
      );
    }
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

  // ---------- Graph styling callbacks ------------------------------------

  const getNodeColor = useCallback(
    (node: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const t = (node as NetworkNode).type;
      if (t === "zone_target") return colors.zoneTarget;
      if (t === "source_post") return colors.sourcePost;
      return colors.avatar;
    },
    [colors]
  );

  const getLinkColor = useCallback(
    (link: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const l = link as NetworkLink;
      if (l.type === "mentions") return colors.mentionLink;
      const s = l.status as NetworkJobStatus | undefined;
      if (s === "done") return colors.completedLink;
      if (s === "failed") return colors.failedLink;
      return colors.pendingLink;
    },
    [colors]
  );

  const getLinkWidth = useCallback((link: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const l = link as NetworkLink;
    if (l.type === "mentions") return 0.3;
    return l.status === "done" ? 1.5 : 0.8;
  }, []);

  const getLinkParticles = useCallback((link: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const l = link as NetworkLink;
    return l.type === "reply_to" && l.status === "done" ? 2 : 0;
  }, []);

  const getNodeLabel = useCallback((node: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const n = node as NetworkNode;
    if (n.type === "zone_target") return `Target: ${n.label}`;
    if (n.type === "source_post") return `Post by ${n.label}`;
    return `Avatar: ${n.label}`;
  }, []);

  // ---------- Render — loading / error / empty ---------------------------

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
            onClick={() => fetchData(true)}
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
          <p className="text-body-sm font-medium text-foreground">
            No network data
          </p>
          <p className="text-caption normal-case">
            Posts and responses will appear as the campaign runs
          </p>
        </div>
      </div>
    );
  }

  // ---------- Render — graph ---------------------------------------------

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-full w-full overflow-hidden",
        "transition-all duration-[var(--transition-base)]",
        isFullscreen && "rounded-none",
        className
      )}
    >
      {/* Header overlay */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-border/40 p-2.5 glass-effect">
        <div className="flex items-center gap-2">
          <h3 className="text-caption normal-case tracking-wider">
            Campaign Map
          </h3>
          <Badge
            variant="secondary"
            className="text-[10px] font-normal tabular-nums"
          >
            {data.stats.totalPosts} posts · {data.stats.totalAvatars} avatars
          </Badge>
          {isFetching && (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          )}
        </div>

        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="ghost" size="icon" className="h-7 w-7" onClick={resetCamera} />}
            >
              <RotateCw className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">Center View</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={<Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleFullscreen} />}
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            </TooltipContent>
          </Tooltip>

          <FilterPopover
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
          background: `radial-gradient(ellipse at center, ${colors.bgCenter} 0%, ${colors.bgEdge} 100%)`,
        }}
      >
        {typeof window !== "undefined" && dimensions.width > 0 && (
          <ForceGraph3D
            ref={fgRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={filteredData}
            nodeLabel={getNodeLabel}
            nodeColor={getNodeColor}
            nodeVal={(n: any) => (n as NetworkNode).value} // eslint-disable-line @typescript-eslint/no-explicit-any
            nodeOpacity={0.92}
            nodeResolution={20}
            linkColor={getLinkColor}
            linkWidth={getLinkWidth}
            linkOpacity={0.45}
            linkDirectionalParticles={getLinkParticles}
            linkDirectionalParticleSpeed={0.003}
            linkDirectionalParticleWidth={1.5}
            linkDirectionalParticleColor={getLinkColor}
            linkCurvature={0.1}
            backgroundColor="rgba(0,0,0,0)"
            onNodeClick={handleNodeClick}
            enableNodeDrag={false}
            enableNavigationControls
            showNavInfo={false}
            cooldownTicks={120}
          />
        )}
      </div>

      {/* Legend */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-5 border-t border-border/40 px-4 py-1.5 glass-effect">
        <LegendDot color="bg-foreground" label="Target" />
        <LegendDot color="bg-muted-foreground" label="Posts" />
        <LegendDot color="bg-primary" label="Avatars" />
        <span className="h-3 w-px bg-border" />
        <LegendDot color="bg-primary" label="Done" size="sm" />
        <LegendDot color="bg-destructive" label="Failed" size="sm" />
      </div>

      {/* Node details panel */}
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
// Sub-components
// ---------------------------------------------------------------------------

function LegendDot({
  color,
  label,
  size = "md",
}: {
  color: string;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "rounded-full",
          color,
          size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2"
        )}
      />
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function FilterPopover({
  nodeFilters,
  statusFilters,
  onNodeFiltersChange,
  onStatusFiltersChange,
}: {
  nodeFilters: NetworkNodeFilters;
  statusFilters: NetworkStatusFilters;
  onNodeFiltersChange: (f: NetworkNodeFilters) => void;
  onStatusFiltersChange: (f: NetworkStatusFilters) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" className="h-7 w-7" />}
      >
        <Filter className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent className="w-52" align="end" sideOffset={8}>
        <div className="space-y-4">
          <p className="text-label">Filters</p>

          <div className="space-y-2.5">
            <p className="text-caption">Nodes</p>
            <FilterSwitch
              id="f-targets"
              label="Targets"
              dotClass="bg-foreground"
              checked={nodeFilters.zoneTargets}
              onChange={(v) => onNodeFiltersChange({ ...nodeFilters, zoneTargets: v })}
            />
            <FilterSwitch
              id="f-posts"
              label="Posts"
              dotClass="bg-muted-foreground"
              checked={nodeFilters.sourcePosts}
              onChange={(v) => onNodeFiltersChange({ ...nodeFilters, sourcePosts: v })}
            />
            <FilterSwitch
              id="f-avatars"
              label="Avatars"
              dotClass="bg-primary"
              checked={nodeFilters.avatars}
              onChange={(v) => onNodeFiltersChange({ ...nodeFilters, avatars: v })}
            />
          </div>

          <div className="space-y-2.5">
            <p className="text-caption">Job Status</p>
            <FilterSwitch
              id="f-done"
              label="Done"
              dotClass="bg-primary"
              checked={statusFilters.done}
              onChange={(v) => onStatusFiltersChange({ ...statusFilters, done: v })}
            />
            <FilterSwitch
              id="f-failed"
              label="Failed"
              dotClass="bg-destructive"
              checked={statusFilters.failed}
              onChange={(v) => onStatusFiltersChange({ ...statusFilters, failed: v })}
            />
            <FilterSwitch
              id="f-pending"
              label="Pending"
              dotClass="bg-muted-foreground/50"
              checked={statusFilters.pending}
              onChange={(v) => onStatusFiltersChange({ ...statusFilters, pending: v })}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FilterSwitch({
  id,
  label,
  dotClass,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  dotClass: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label htmlFor={id} className="flex items-center gap-2 text-body-sm">
        <span className={cn("h-2 w-2 rounded-full", dotClass)} />
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
