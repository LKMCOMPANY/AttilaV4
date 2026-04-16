"use client";

/**
 * PackedBubbleChart — SVG packed circle renderer for the avatar cartography.
 *
 * Renders a two-level packed circle layout: cluster parents (translucent)
 * containing avatar leaves (solid). Supports zoom, pan, hover, and click.
 */

import {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
  memo,
} from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { useBubblePack } from "@/hooks/use-bubble-pack";
import type {
  ConstellationNode,
  ClusterDimension,
  ClusterGroup,
  PackedBubble,
} from "@/types/cartography";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PackedBubbleChartProps {
  nodes: ConstellationNode[];
  dimension: ClusterDimension;
  onNodeHover: (node: ConstellationNode | null, x: number, y: number) => void;
  onNodeClick: (node: ConstellationNode | null) => void;
  onClustersReady: (clusters: ClusterGroup[]) => void;
  focusedCluster: string | null;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Zoom/pan state
// ---------------------------------------------------------------------------

interface Transform {
  x: number;
  y: number;
  k: number;
}

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 4;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PackedBubbleChart = memo(function PackedBubbleChart({
  nodes,
  dimension,
  onNodeHover,
  onNodeClick,
  onClustersReady,
  focusedCluster,
  className,
}: PackedBubbleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize({ width: rect.width, height: rect.height });
      }
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset transform on dimension change
  useEffect(() => {
    setTransform({ x: 0, y: 0, k: 1 });
  }, [dimension]);

  const { bubbles, clusters } = useBubblePack({
    nodes,
    dimension,
    width: size.width,
    height: size.height,
  });

  useEffect(() => {
    onClustersReady(clusters);
  }, [clusters, onClustersReady]);

  // Pre-compute cluster avatar counts to avoid O(n*m) in JSX
  const clusterAvatarCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of bubbles) {
      if (b.type === "avatar") {
        counts.set(b.clusterKey, (counts.get(b.clusterKey) ?? 0) + 1);
      }
    }
    return counts;
  }, [bubbles]);

  // Focus on a specific cluster
  useEffect(() => {
    if (!focusedCluster || size.width === 0) {
      if (!focusedCluster) setTransform({ x: 0, y: 0, k: 1 });
      return;
    }

    const clusterBubble = bubbles.find(
      (b) => b.type === "cluster" && b.clusterKey === focusedCluster
    );
    if (!clusterBubble) return;

    const targetK = Math.min(
      MAX_ZOOM,
      Math.max(1.5, Math.min(size.width, size.height) / (clusterBubble.r * 2.4))
    );
    setTransform({
      x: size.width / 2 - clusterBubble.x * targetK,
      y: size.height / 2 - clusterBubble.y * targetK,
      k: targetK,
    });
  }, [focusedCluster, bubbles, size.width, size.height]);

  // ---------------------------------------------------------------------------
  // Mouse handlers
  // ---------------------------------------------------------------------------

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        tx: transform.x,
        ty: transform.y,
      };
    },
    [transform]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!isPanning) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setTransform((prev) => ({
        ...prev,
        x: panStartRef.current.tx + dx,
        y: panStartRef.current.ty + dy,
      }));
    },
    [isPanning]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      setTransform((prev) => {
        const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
        const newK = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.k * factor));
        return {
          x: mx - (mx - prev.x) * (newK / prev.k),
          y: my - (my - prev.y) * (newK / prev.k),
          k: newK,
        };
      });
    },
    []
  );

  const handleDoubleClick = useCallback(() => {
    setTransform({ x: 0, y: 0, k: 1 });
  }, []);

  // ---------------------------------------------------------------------------
  // Bubble event handlers
  // ---------------------------------------------------------------------------

  const handleBubbleHover = useCallback(
    (bubble: PackedBubble | null, e?: React.MouseEvent) => {
      if (bubble?.node) {
        setHoveredId(bubble.id);
        onNodeHover(bubble.node, e?.clientX ?? 0, e?.clientY ?? 0);
      } else {
        setHoveredId(null);
        onNodeHover(null, 0, 0);
      }
    },
    [onNodeHover]
  );

  const handleBubbleClick = useCallback(
    (bubble: PackedBubble, e: React.MouseEvent) => {
      e.stopPropagation();
      if (bubble.node) {
        onNodeClick(bubble.node);
      }
    },
    [onNodeClick]
  );

  // ---------------------------------------------------------------------------
  // Separate cluster and avatar bubbles
  // ---------------------------------------------------------------------------

  const clusterBubbles = useMemo(
    () => bubbles.filter((b) => b.type === "cluster"),
    [bubbles]
  );
  const avatarBubbles = useMemo(
    () => bubbles.filter((b) => b.type === "avatar"),
    [bubbles]
  );

  const { width, height } = size;

  return (
    <div
      ref={containerRef}
      className={cn("relative h-full w-full overflow-hidden", className)}
    >
      {width > 0 && height > 0 && (
        <svg
          width={width}
          height={height}
          className="select-none"
          style={{ cursor: isPanning ? "grabbing" : "grab" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
        >
          {/* Background gradient */}
          <defs>
            <radialGradient id="carto-bg" cx="50%" cy="50%" r="70%">
              <stop
                offset="0%"
                stopColor={isDark ? "#1f1d19" : "#faf9f7"}
              />
              <stop
                offset="100%"
                stopColor={isDark ? "#15140f" : "#f0eee9"}
              />
            </radialGradient>
          </defs>

          <rect width={width} height={height} fill="url(#carto-bg)" />

          <g
            transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}
            style={{ transition: isPanning ? "none" : "transform 0.4s ease-out" }}
          >
            {/* Cluster parent circles */}
            {clusterBubbles.map((b) => (
              <g key={b.id}>
                <circle
                  cx={b.x}
                  cy={b.y}
                  r={b.r}
                  fill={hexToRgba(b.color, isDark ? 0.08 : 0.06)}
                  stroke={hexToRgba(b.color, isDark ? 0.2 : 0.15)}
                  strokeWidth={1}
                  style={{ transition: "cx 0.6s ease-out, cy 0.6s ease-out, r 0.6s ease-out" }}
                />
                <text
                  x={b.x}
                  y={b.y - b.r + 16 / transform.k}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={hexToRgba(b.color, isDark ? 0.8 : 0.65)}
                  fontSize={Math.max(10, Math.min(13, 12 / transform.k))}
                  fontWeight={500}
                  fontFamily="var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif"
                  style={{
                    paintOrder: "stroke",
                    stroke: isDark ? "rgba(21,20,15,0.85)" : "rgba(250,249,247,0.85)",
                    strokeWidth: 3 / transform.k,
                    strokeLinejoin: "round",
                    transition: "x 0.6s ease-out, y 0.6s ease-out",
                  }}
                >
                  {b.label} · {clusterAvatarCounts.get(b.clusterKey) ?? 0}
                </text>
              </g>
            ))}

            {/* Avatar leaf circles */}
            {avatarBubbles.map((b) => {
              const isHovered = hoveredId === b.id;
              return (
                <g key={b.id}>
                  {isHovered && (
                    <circle
                      cx={b.x}
                      cy={b.y}
                      r={b.r * 2.5}
                      fill={hexToRgba(b.color, 0.2)}
                      style={{ transition: "r 0.2s ease-out" }}
                    />
                  )}
                  <circle
                    cx={b.x}
                    cy={b.y}
                    r={isHovered ? b.r * 1.3 : b.r}
                    fill={isHovered ? b.color : hexToRgba(b.color, 0.88)}
                    style={{
                      cursor: "pointer",
                      transition: "cx 0.6s ease-out, cy 0.6s ease-out, r 0.2s ease-out, fill 0.15s",
                    }}
                    onMouseEnter={(e) => handleBubbleHover(b, e)}
                    onMouseLeave={() => handleBubbleHover(null)}
                    onClick={(e) => handleBubbleClick(b, e)}
                  />
                  <circle
                    cx={b.x}
                    cy={b.y}
                    r={(isHovered ? b.r * 1.3 : b.r) * 0.3}
                    fill={hexToRgba("#ffffff", isHovered ? 0.6 : 0.3)}
                    pointerEvents="none"
                    style={{ transition: "r 0.2s ease-out" }}
                  />
                </g>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
});
