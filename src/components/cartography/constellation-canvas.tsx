"use client";

/**
 * ConstellationCanvas — Canvas 2D renderer for the avatar constellation map.
 *
 * Renders nodes as glowing dots, cluster hulls as soft nebulae,
 * and handles hover/click interactions via hit-testing.
 */

import {
  useRef,
  useEffect,
  useCallback,
  useState,
  memo,
} from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { useConstellation, CLUSTER_PALETTE } from "@/hooks/use-constellation";
import type {
  ConstellationNode,
  ClusterDimension,
  ClusterGroup,
} from "@/types/cartography";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ConstellationCanvasProps {
  nodes: ConstellationNode[];
  dimension: ClusterDimension;
  onNodeHover: (node: ConstellationNode | null, x: number, y: number) => void;
  onNodeClick: (node: ConstellationNode | null) => void;
  onClustersReady: (clusters: ClusterGroup[]) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HIT_RADIUS = 14;
const MIN_NODE_RADIUS = 3.5;
const MAX_NODE_RADIUS = 10;

// ---------------------------------------------------------------------------
// Hex to RGBA helper
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ConstellationCanvas = memo(function ConstellationCanvas({
  nodes,
  dimension,
  onNodeHover,
  onNodeClick,
  onClustersReady,
  className,
}: ConstellationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const hoveredIdRef = useRef<string | null>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Resize observer
  useEffect(() => {
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
  }, []);

  // Draw callback — called on every simulation tick
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = dimensions.width;
    const h = dimensions.height;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    if (isDark) {
      bgGrad.addColorStop(0, "#1f1d19");
      bgGrad.addColorStop(1, "#15140f");
    } else {
      bgGrad.addColorStop(0, "#faf9f7");
      bgGrad.addColorStop(1, "#f0eee9");
    }
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Build cluster groups for hull drawing
    const clusterNodes = new Map<string, ConstellationNode[]>();
    for (const node of simulationNodes) {
      const key = node.clusters[dimension];
      const list = clusterNodes.get(key) ?? [];
      list.push(node);
      clusterNodes.set(key, list);
    }

    // Draw cluster hulls (nebula effect)
    const clusterColorMap = new Map<string, string>();
    for (const cluster of clusters) {
      clusterColorMap.set(cluster.key, cluster.color);
    }

    for (const [key, cnodes] of clusterNodes) {
      if (cnodes.length < 2) continue;

      const color = clusterColorMap.get(key) ?? CLUSTER_PALETTE[0];
      const cx = cnodes.reduce((s, n) => s + (n.x ?? 0), 0) / cnodes.length;
      const cy = cnodes.reduce((s, n) => s + (n.y ?? 0), 0) / cnodes.length;

      // Compute max distance from centroid
      let maxDist = 0;
      for (const n of cnodes) {
        const dx = (n.x ?? 0) - cx;
        const dy = (n.y ?? 0) - cy;
        maxDist = Math.max(maxDist, Math.hypot(dx, dy));
      }

      const radius = maxDist + 30;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, hexToRgba(color, isDark ? 0.08 : 0.06));
      grad.addColorStop(0.7, hexToRgba(color, isDark ? 0.04 : 0.03));
      grad.addColorStop(1, hexToRgba(color, 0));

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // Cluster label
      ctx.fillStyle = hexToRgba(color, isDark ? 0.6 : 0.5);
      ctx.font = "500 10px var(--font-geist-sans), system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(key.toUpperCase(), cx, cy - maxDist - 12);
    }

    // Draw nodes
    for (const node of simulationNodes) {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const key = node.clusters[dimension];
      const color = clusterColorMap.get(key) ?? CLUSTER_PALETTE[0];
      const isHovered = hoveredIdRef.current === node.id;

      // Node radius based on activity
      const activity = Math.log10(Math.max(node.automatorJobs, 1) + 1);
      const baseRadius = MIN_NODE_RADIUS + (activity / 3) * (MAX_NODE_RADIUS - MIN_NODE_RADIUS);
      const radius = isHovered ? baseRadius * 1.5 : baseRadius;

      // Glow
      if (isHovered || node.automatorJobs > 10) {
        const glowRadius = radius * (isHovered ? 4 : 2.5);
        const glow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
        glow.addColorStop(0, hexToRgba(color, isHovered ? 0.3 : 0.15));
        glow.addColorStop(1, hexToRgba(color, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Node dot
      ctx.fillStyle = isHovered ? color : hexToRgba(color, 0.85);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      // Inner bright core
      ctx.fillStyle = hexToRgba("#ffffff", isHovered ? 0.6 : 0.25);
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [dimensions, isDark, dimension]); // eslint-disable-line react-hooks/exhaustive-deps

  // d3-force simulation
  const { simulationNodes, clusters, reheat } = useConstellation({
    nodes,
    dimension,
    width: dimensions.width,
    height: dimensions.height,
    onTick: draw,
  });

  // Report clusters up
  useEffect(() => {
    onClustersReady(clusters);
  }, [clusters, onClustersReady]);

  // Reheat on dimension change
  useEffect(() => {
    reheat();
  }, [dimension, reheat]);

  // Hit-testing for mouse interactions
  const findNodeAt = useCallback(
    (mx: number, my: number): ConstellationNode | null => {
      let closest: ConstellationNode | null = null;
      let closestDist = HIT_RADIUS;

      for (const node of simulationNodes) {
        const dx = (node.x ?? 0) - mx;
        const dy = (node.y ?? 0) - my;
        const dist = Math.hypot(dx, dy);
        if (dist < closestDist) {
          closest = node;
          closestDist = dist;
        }
      }
      return closest;
    },
    [simulationNodes]
  );

  // Mouse handlers
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = findNodeAt(mx, my);

      hoveredIdRef.current = node?.id ?? null;
      onNodeHover(node, e.clientX, e.clientY);

      if (canvasRef.current) {
        canvasRef.current.style.cursor = node ? "pointer" : "default";
      }

      draw();
    },
    [findNodeAt, onNodeHover, draw]
  );

  const handleMouseLeave = useCallback(() => {
    hoveredIdRef.current = null;
    onNodeHover(null, 0, 0);
    draw();
  }, [onNodeHover, draw]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = findNodeAt(mx, my);
      onNodeClick(node);
    },
    [findNodeAt, onNodeClick]
  );

  return (
    <div ref={containerRef} className={cn("relative h-full w-full", className)}>
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      />
    </div>
  );
});
