"use client";

/**
 * ConstellationCanvas — Canvas 2D renderer for the avatar constellation map.
 *
 * Renders nodes as glowing dots with cluster nebulae.
 * Supports zoom (wheel), pan (drag), and auto-fit.
 * Node sizing adapts to the active clustering dimension.
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

const HIT_RADIUS = 18;
const MIN_NODE_RADIUS = 4;
const MAX_NODE_RADIUS = 14;
const AUTO_FIT_PADDING = 100;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getSizeMetric(node: ConstellationNode, dimension: ClusterDimension): number {
  switch (dimension) {
    case "automator_usage":
      return node.automatorJobs;
    case "operator_usage":
      return node.operatorCount * 5 + node.contentItemCount;
    case "platform":
      return node.platformCount * 3;
    case "army":
      return node.armyCount * 3 + node.automatorJobs;
    default:
      return Math.max(node.automatorJobs, node.operatorCount * 3, 1);
  }
}

// ---------------------------------------------------------------------------
// Transform type for zoom/pan
// ---------------------------------------------------------------------------

interface Transform {
  x: number;
  y: number;
  k: number; // scale
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

  // Stable refs for draw callback
  const simNodesRef = useRef<ConstellationNode[]>([]);
  const clustersRef = useRef<ClusterGroup[]>([]);
  const dimensionRef = useRef<ClusterDimension>(dimension);
  const isDarkRef = useRef(isDark);
  const dimsRef = useRef(dimensions);
  const prevCanvasSize = useRef({ w: 0, h: 0 });

  // Zoom/pan state
  const transformRef = useRef<Transform>({ x: 0, y: 0, k: 1 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const autoFitDoneRef = useRef(false);

  dimensionRef.current = dimension;
  isDarkRef.current = isDark;
  dimsRef.current = dimensions;

  // Reset auto-fit when dimension changes so we re-fit
  useEffect(() => {
    autoFitDoneRef.current = false;
  }, [dimension]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setDimensions({ width: rect.width, height: rect.height });
        autoFitDoneRef.current = false;
      }
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-fit: compute transform to show all nodes with padding
  const computeAutoFit = useCallback((): Transform | null => {
    const simNodes = simNodesRef.current;
    const w = dimsRef.current.width;
    const h = dimsRef.current.height;

    if (simNodes.length === 0 || w === 0 || h === 0) return null;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of simNodes) {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const bboxW = maxX - minX || 100;
    const bboxH = maxY - minY || 100;
    const k = Math.min(
      (w - AUTO_FIT_PADDING * 2) / bboxW,
      (h - AUTO_FIT_PADDING * 2) / bboxH,
      MAX_ZOOM
    );
    const clampedK = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k));

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    return {
      x: w / 2 - centerX * clampedK,
      y: h / 2 - centerY * clampedK,
      k: clampedK,
    };
  }, []);

  // Draw callback — reads everything from refs
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = dimsRef.current.width;
    const h = dimsRef.current.height;
    const dark = isDarkRef.current;
    const dim = dimensionRef.current;
    const simNodes = simNodesRef.current;
    const clusterList = clustersRef.current;
    const t = transformRef.current;

    if (w === 0 || h === 0) return;

    // Auto-fit after simulation warms up (run once per dimension)
    if (!autoFitDoneRef.current && simNodes.length > 0) {
      const hasSettled = simNodes.every(
        (n) => n.x !== undefined && n.y !== undefined
      );
      if (hasSettled) {
        const fit = computeAutoFit();
        if (fit) {
          transformRef.current = fit;
          autoFitDoneRef.current = true;
        }
      }
    }

    // Canvas size setup (only when needed)
    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (prevCanvasSize.current.w !== targetW || prevCanvasSize.current.h !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      prevCanvasSize.current = { w: targetW, h: targetH };
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    if (dark) {
      bgGrad.addColorStop(0, "#1f1d19");
      bgGrad.addColorStop(1, "#15140f");
    } else {
      bgGrad.addColorStop(0, "#faf9f7");
      bgGrad.addColorStop(1, "#f0eee9");
    }
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Apply zoom/pan transform
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    // Cluster color lookup
    const clusterColorMap = new Map<string, string>();
    for (const cluster of clusterList) {
      clusterColorMap.set(cluster.key, cluster.color);
    }

    // Group nodes by cluster
    const clusterNodeGroups = new Map<string, ConstellationNode[]>();
    for (const node of simNodes) {
      const key = node.clusters[dim];
      const list = clusterNodeGroups.get(key) ?? [];
      list.push(node);
      clusterNodeGroups.set(key, list);
    }

    // Draw cluster nebulae
    for (const [key, cnodes] of clusterNodeGroups) {
      const color = clusterColorMap.get(key) ?? CLUSTER_PALETTE[0];
      const cx = cnodes.reduce((s, n) => s + (n.x ?? 0), 0) / cnodes.length;
      const cy = cnodes.reduce((s, n) => s + (n.y ?? 0), 0) / cnodes.length;

      let maxDist = 0;
      for (const n of cnodes) {
        const dx = (n.x ?? 0) - cx;
        const dy = (n.y ?? 0) - cy;
        maxDist = Math.max(maxDist, Math.hypot(dx, dy));
      }

      const radius = maxDist + 40;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, hexToRgba(color, dark ? 0.1 : 0.07));
      grad.addColorStop(0.6, hexToRgba(color, dark ? 0.05 : 0.035));
      grad.addColorStop(1, hexToRgba(color, 0));

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // Cluster label — scale-compensated so it stays readable at any zoom
      const fontSize = Math.round(Math.max(10, Math.min(13, 12 / t.k)));
      const labelText = `${key}  ·  ${cnodes.length}`;
      const labelY = cy - maxDist - 16;

      ctx.font = `500 ${fontSize}px "Geist Sans", ui-sans-serif, system-ui, -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Halo for readability
      ctx.strokeStyle = dark ? "rgba(21, 20, 15, 0.85)" : "rgba(250, 249, 247, 0.85)";
      ctx.lineWidth = 3 / t.k;
      ctx.lineJoin = "round";
      ctx.strokeText(labelText, cx, labelY);

      // Fill
      ctx.fillStyle = hexToRgba(color, dark ? 0.8 : 0.65);
      ctx.fillText(labelText, cx, labelY);

      ctx.textBaseline = "alphabetic";
    }

    // Draw nodes
    for (const node of simNodes) {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const key = node.clusters[dim];
      const color = clusterColorMap.get(key) ?? CLUSTER_PALETTE[0];
      const isHovered = hoveredIdRef.current === node.id;

      // Dimension-aware sizing
      const metric = getSizeMetric(node, dim);
      const logMetric = Math.log10(Math.max(metric, 1) + 1);
      const baseRadius = MIN_NODE_RADIUS + (logMetric / 2.5) * (MAX_NODE_RADIUS - MIN_NODE_RADIUS);
      const radius = isHovered ? baseRadius * 1.6 : baseRadius;

      // Glow
      if (isHovered || metric > 5) {
        const glowRadius = radius * (isHovered ? 4.5 : 2.5);
        const glow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
        glow.addColorStop(0, hexToRgba(color, isHovered ? 0.35 : 0.12));
        glow.addColorStop(1, hexToRgba(color, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Node dot
      ctx.fillStyle = isHovered ? color : hexToRgba(color, 0.88);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      // Inner bright core
      ctx.fillStyle = hexToRgba("#ffffff", isHovered ? 0.65 : 0.3);
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }, [computeAutoFit]);

  // d3-force simulation
  const { simulationNodes, clusters, reheat } = useConstellation({
    nodes,
    dimension,
    width: dimensions.width,
    height: dimensions.height,
    onTick: draw,
  });

  // Sync refs
  simNodesRef.current = simulationNodes;
  clustersRef.current = clusters;

  useEffect(() => {
    onClustersReady(clusters);
  }, [clusters, onClustersReady]);

  useEffect(() => {
    reheat();
  }, [dimension, reheat]);

  // ---------------------------------------------------------------------------
  // Coordinate transform helpers
  // ---------------------------------------------------------------------------

  const screenToWorld = useCallback((sx: number, sy: number): { x: number; y: number } => {
    const t = transformRef.current;
    return {
      x: (sx - t.x) / t.k,
      y: (sy - t.y) / t.k,
    };
  }, []);

  const findNodeAt = useCallback(
    (sx: number, sy: number): ConstellationNode | null => {
      const { x: wx, y: wy } = screenToWorld(sx, sy);
      let closest: ConstellationNode | null = null;
      let closestDist = HIT_RADIUS / transformRef.current.k;

      for (const node of simNodesRef.current) {
        const dx = (node.x ?? 0) - wx;
        const dy = (node.y ?? 0) - wy;
        const dist = Math.hypot(dx, dy);
        if (dist < closestDist) {
          closest = node;
          closestDist = dist;
        }
      }
      return closest;
    },
    [screenToWorld]
  );

  // ---------------------------------------------------------------------------
  // Mouse handlers: hover, click, wheel zoom, drag pan
  // ---------------------------------------------------------------------------

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // Pan
      if (isPanningRef.current) {
        const dx = mx - panStartRef.current.x;
        const dy = my - panStartRef.current.y;
        transformRef.current = {
          ...transformRef.current,
          x: transformRef.current.x + dx,
          y: transformRef.current.y + dy,
        };
        panStartRef.current = { x: mx, y: my };
        draw();
        return;
      }

      const node = findNodeAt(mx, my);
      hoveredIdRef.current = node?.id ?? null;
      onNodeHover(node, e.clientX, e.clientY);

      if (canvasRef.current) {
        canvasRef.current.style.cursor = node ? "pointer" : "grab";
      }
      draw();
    },
    [findNodeAt, onNodeHover, draw]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = findNodeAt(mx, my);

      if (!node) {
        isPanningRef.current = true;
        panStartRef.current = { x: mx, y: my };
        if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
      }
    },
    [findNodeAt]
  );

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
    if (canvasRef.current) canvasRef.current.style.cursor = "grab";
  }, []);

  const handleMouseLeave = useCallback(() => {
    isPanningRef.current = false;
    hoveredIdRef.current = null;
    onNodeHover(null, 0, 0);
    draw();
  }, [onNodeHover, draw]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (isPanningRef.current) return;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = findNodeAt(mx, my);
      onNodeClick(node);
    },
    [findNodeAt, onNodeClick]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const t = transformRef.current;
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      const newK = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, t.k * factor));

      // Zoom centered on cursor position
      transformRef.current = {
        x: mx - (mx - t.x) * (newK / t.k),
        y: my - (my - t.y) * (newK / t.k),
        k: newK,
      };

      draw();
    },
    [draw]
  );

  // Double-click to reset view (auto-fit)
  const handleDoubleClick = useCallback(() => {
    const fit = computeAutoFit();
    if (fit) {
      transformRef.current = fit;
      draw();
    }
  }, [computeAutoFit, draw]);

  return (
    <div ref={containerRef} className={cn("relative h-full w-full", className)}>
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  );
});
