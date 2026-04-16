"use client";

/**
 * useConstellation — d3-force simulation hook for the avatar constellation map.
 *
 * Manages the force simulation and regroups nodes when the active
 * clustering dimension changes, with smooth animated transitions.
 */

import { useRef, useEffect, useCallback, useMemo } from "react";
import {
  forceSimulation,
  forceX,
  forceY,
  forceCollide,
  forceManyBody,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import type {
  ConstellationNode,
  ClusterDimension,
  ClusterGroup,
} from "@/types/cartography";

// ---------------------------------------------------------------------------
// Palette — 12 distinct hues for clusters (hex, matching design system tones)
// ---------------------------------------------------------------------------

const CLUSTER_PALETTE = [
  "#b8a46c", // primary gold (dark)
  "#e07c52", // warm orange
  "#6ca4b8", // steel blue
  "#8cb86c", // olive green
  "#b86c9a", // mauve
  "#6c6eb8", // indigo
  "#b8986c", // tan
  "#52a0e0", // sky blue
  "#e05252", // destructive red
  "#6cb8a4", // teal
  "#b86c6c", // rose
  "#a4b86c", // lime
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseConstellationParams {
  nodes: ConstellationNode[];
  dimension: ClusterDimension;
  width: number;
  height: number;
  onTick: () => void;
}

interface UseConstellationReturn {
  simulationNodes: ConstellationNode[];
  clusters: ClusterGroup[];
  reheat: () => void;
}

// ---------------------------------------------------------------------------
// Cluster center computation
// ---------------------------------------------------------------------------

function computeClusterCenters(
  keys: string[],
  width: number,
  height: number
): Map<string, { x: number; y: number }> {
  const centers = new Map<string, { x: number; y: number }>();
  const count = keys.length;

  if (count === 0) return centers;
  if (count === 1) {
    centers.set(keys[0], { x: width / 2, y: height / 2 });
    return centers;
  }

  // Arrange clusters in concentric rings
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.3;

  if (count <= 6) {
    keys.forEach((key, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2;
      centers.set(key, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    });
  } else {
    // Inner ring: first 6, outer ring: rest
    const innerCount = Math.min(6, count);
    const outerCount = count - innerCount;
    const outerRadius = radius * 1.5;

    keys.slice(0, innerCount).forEach((key, i) => {
      const angle = (2 * Math.PI * i) / innerCount - Math.PI / 2;
      centers.set(key, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    });

    keys.slice(innerCount).forEach((key, i) => {
      const angle = (2 * Math.PI * i) / outerCount - Math.PI / 2;
      centers.set(key, {
        x: cx + outerRadius * Math.cos(angle),
        y: cy + outerRadius * Math.sin(angle),
      });
    });
  }

  return centers;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useConstellation({
  nodes,
  dimension,
  width,
  height,
  onTick,
}: UseConstellationParams): UseConstellationReturn {
  const simRef = useRef<Simulation<SimulationNodeDatum, undefined> | null>(null);
  const nodesRef = useRef<ConstellationNode[]>([]);

  // Build cluster groups for current dimension
  const clusters = useMemo(() => {
    const keyCount = new Map<string, number>();
    for (const node of nodes) {
      const key = node.clusters[dimension];
      keyCount.set(key, (keyCount.get(key) ?? 0) + 1);
    }

    // Sort by count descending for consistent layout
    const sorted = [...keyCount.entries()].sort((a, b) => b[1] - a[1]);

    return sorted.map(([key, count], i): ClusterGroup => ({
      key,
      label: key,
      color: CLUSTER_PALETTE[i % CLUSTER_PALETTE.length],
      nodeCount: count,
    }));
  }, [nodes, dimension]);

  // Cluster centers
  const clusterCenters = useMemo(() => {
    const keys = clusters.map((c) => c.key);
    return computeClusterCenters(keys, width, height);
  }, [clusters, width, height]);

  // Initialize or update simulation
  useEffect(() => {
    if (width === 0 || height === 0 || nodes.length === 0) return;

    // Copy nodes to avoid mutating props
    const simNodes = nodes.map((n) => ({
      ...n,
      x: n.x ?? width / 2 + (Math.random() - 0.5) * 100,
      y: n.y ?? height / 2 + (Math.random() - 0.5) * 100,
    }));

    // Preserve positions from previous simulation
    const prevMap = new Map<string, { x: number; y: number }>();
    for (const pn of nodesRef.current) {
      if (pn.x !== undefined && pn.y !== undefined) {
        prevMap.set(pn.id, { x: pn.x, y: pn.y });
      }
    }
    for (const sn of simNodes) {
      const prev = prevMap.get(sn.id);
      if (prev) {
        sn.x = prev.x;
        sn.y = prev.y;
      }
    }

    nodesRef.current = simNodes;

    // Stop previous simulation
    if (simRef.current) simRef.current.stop();

    const nodeRadius = Math.max(4, Math.min(8, 200 / Math.sqrt(nodes.length)));

    const sim = forceSimulation(simNodes as unknown as SimulationNodeDatum[])
      .force(
        "x",
        forceX<SimulationNodeDatum>((d) => {
          const node = d as unknown as ConstellationNode;
          const key = node.clusters[dimension];
          return clusterCenters.get(key)?.x ?? width / 2;
        }).strength(0.12)
      )
      .force(
        "y",
        forceY<SimulationNodeDatum>((d) => {
          const node = d as unknown as ConstellationNode;
          const key = node.clusters[dimension];
          return clusterCenters.get(key)?.y ?? height / 2;
        }).strength(0.12)
      )
      .force("charge", forceManyBody().strength(-15).distanceMax(150))
      .force("collide", forceCollide(nodeRadius + 2).strength(0.7))
      .alphaDecay(0.02)
      .velocityDecay(0.35)
      .on("tick", onTick);

    sim.alpha(0.8).restart();
    simRef.current = sim;

    return () => {
      sim.stop();
    };
  }, [nodes, dimension, width, height, clusterCenters, onTick]);

  // Update cluster centroids after simulation settles
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const cluster of clusters) {
        const clusterNodes = nodesRef.current.filter(
          (n) => n.clusters[dimension] === cluster.key
        );
        if (clusterNodes.length > 0) {
          cluster.centroidX =
            clusterNodes.reduce((sum, n) => sum + (n.x ?? 0), 0) /
            clusterNodes.length;
          cluster.centroidY =
            clusterNodes.reduce((sum, n) => sum + (n.y ?? 0), 0) /
            clusterNodes.length;
        }
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [clusters, dimension]);

  const reheat = useCallback(() => {
    if (simRef.current) {
      simRef.current.alpha(0.6).restart();
    }
  }, []);

  return {
    simulationNodes: nodesRef.current,
    clusters,
    reheat,
  };
}

export { CLUSTER_PALETTE };
