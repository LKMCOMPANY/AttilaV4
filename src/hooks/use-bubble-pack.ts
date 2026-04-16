"use client";

/**
 * useBubblePack — d3-hierarchy packed circle layout for the avatar cartography.
 *
 * Builds a two-level hierarchy (root → clusters → avatar leaves) and runs
 * d3.pack() to compute x, y, r for each bubble.
 */

import { useMemo } from "react";
import { hierarchy, pack, type HierarchyCircularNode } from "d3-hierarchy";
import type {
  ConstellationNode,
  ClusterDimension,
  ClusterGroup,
  PackedBubble,
  BubbleHierarchyNode,
} from "@/types/cartography";

// ---------------------------------------------------------------------------
// Palette — 12 distinct hues for clusters (matches design system tones)
// ---------------------------------------------------------------------------

export const CLUSTER_PALETTE = [
  "#b8a46c", // primary gold
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
// Size metric per dimension — determines leaf bubble size
// ---------------------------------------------------------------------------

function getSizeMetric(
  node: ConstellationNode,
  dimension: ClusterDimension
): number {
  switch (dimension) {
    case "automator_usage":
      return Math.max(node.automatorJobs, 1);
    case "operator_usage":
      return Math.max(node.operatorCount * 5 + node.contentItemCount, 1);
    case "platform":
      return Math.max(node.platformCount * 3, 1);
    case "army":
      return Math.max(node.armyCount * 3 + node.automatorJobs, 1);
    default:
      return Math.max(node.automatorJobs + node.operatorCount * 3, 1);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseBubblePackParams {
  nodes: ConstellationNode[];
  dimension: ClusterDimension;
  width: number;
  height: number;
}

interface UseBubblePackReturn {
  bubbles: PackedBubble[];
  clusters: ClusterGroup[];
}

export function useBubblePack({
  nodes,
  dimension,
  width,
  height,
}: UseBubblePackParams): UseBubblePackReturn {
  const { clusters, colorMap } = useMemo(() => {
    const keyCount = new Map<string, number>();
    for (const n of nodes) {
      const key = n.clusters[dimension];
      keyCount.set(key, (keyCount.get(key) ?? 0) + 1);
    }

    const sorted = [...keyCount.entries()].sort((a, b) => b[1] - a[1]);
    const cMap = new Map<string, string>();
    const cGroups: ClusterGroup[] = sorted.map(([key, count], i) => {
      const color = CLUSTER_PALETTE[i % CLUSTER_PALETTE.length];
      cMap.set(key, color);
      return { key, label: key, color, nodeCount: count };
    });

    return { clusters: cGroups, colorMap: cMap };
  }, [nodes, dimension]);

  const bubbles = useMemo(() => {
    if (width === 0 || height === 0 || nodes.length === 0) return [];

    const clusterMap = new Map<string, ConstellationNode[]>();
    for (const n of nodes) {
      const key = n.clusters[dimension];
      const list = clusterMap.get(key) ?? [];
      list.push(n);
      clusterMap.set(key, list);
    }

    const rootData: BubbleHierarchyNode = {
      id: "root",
      type: "root",
      label: "root",
      color: "",
      value: 0,
      children: [...clusterMap.entries()].map(([key, members]) => ({
        id: `cluster-${key}`,
        type: "cluster" as const,
        label: key,
        color: colorMap.get(key) ?? CLUSTER_PALETTE[0],
        value: 0,
        children: members.map((m) => ({
          id: m.id,
          type: "avatar" as const,
          label: m.label,
          color: colorMap.get(key) ?? CLUSTER_PALETTE[0],
          value: getSizeMetric(m, dimension),
          node: m,
        })),
      })),
    };

    const size = Math.min(width, height);
    const root = hierarchy(rootData)
      .sum((d) => (d.type === "avatar" ? d.value : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const packer = pack<BubbleHierarchyNode>()
      .size([size, size])
      .padding((d) => (d.depth === 0 ? 12 : 4));

    const packed = packer(root) as HierarchyCircularNode<BubbleHierarchyNode>;

    const offsetX = (width - size) / 2;
    const offsetY = (height - size) / 2;

    const result: PackedBubble[] = [];

    for (const d of packed.descendants()) {
      if (d.depth === 0) continue;

      const data = d.data;
      result.push({
        id: data.id,
        type: data.type as "cluster" | "avatar",
        label: data.label,
        color: data.color,
        x: d.x + offsetX,
        y: d.y + offsetY,
        r: d.r,
        node: data.node,
        clusterKey: d.depth === 1 ? data.label : d.parent?.data.label ?? "",
      });
    }

    return result;
  }, [nodes, dimension, width, height, colorMap]);

  return { bubbles, clusters };
}
