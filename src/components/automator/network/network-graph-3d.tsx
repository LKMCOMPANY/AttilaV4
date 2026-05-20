"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import dynamic from "next/dynamic";
import type {
  ForceGraphMethods,
  LinkObject,
  NodeObject,
} from "react-force-graph-3d";
import { NetworkMapSkeleton } from "./network-map-skeleton";
import type { NetworkThemeColors } from "./network-theme";
import type {
  NetworkJobStatus,
  NetworkLink,
  NetworkNode,
} from "@/types/network";

/**
 * 3D force-directed renderer for the campaign map.
 *
 * Pure presentational — receives the graph data + theme + click handler
 * and exposes a small imperative API (`focusNode`, `resetCamera`) for
 * the orchestrator to drive camera moves on selection / theme changes.
 *
 * Auto-rotation pauses while a node is focused. Stopping rotation
 * before computing camera deltas avoids a visible jitter on focus.
 */

// WebGL must run client-side only — Next.js dynamic import with SSR off.
const ForceGraph3D = dynamic(
  () => import("react-force-graph-3d").then((mod) => mod.default),
  { ssr: false, loading: () => <NetworkMapSkeleton /> },
);

const CAMERA_DISTANCE = 350;
const ROTATION_SPEED = 0.0002;
const ROTATION_START_DELAY_MS = 1500;
const ROTATION_LERP = 0.003;

// `react-force-graph-3d` ships strict accessor types but its generic
// parameters don't flow forward consistently — passing typed nodes/links
// through `<ForceGraph3D<NetworkNode, NetworkLink>>` produces an internal
// type mismatch on the imperative-handle ref. The pragmatic, widely-used
// workaround is to use the library's default types at every boundary and
// cast to our domain shape inside the accessor body. The runtime shape
// is identical: we hand the lib our `NetworkNode`/`NetworkLink` objects
// in `graphData`, and it hands the same objects back to the accessors.
//
// All casts are encapsulated in these two helpers so the rest of the
// file reads in domain terms.

function asNetworkNode(n: NodeObject): NetworkNode {
  return n as unknown as NetworkNode;
}

function asNetworkLink(l: LinkObject): NetworkLink {
  return l as unknown as NetworkLink;
}

export interface NetworkGraph3DHandle {
  /** Smoothly recenter the camera on the origin (the zone target). */
  resetCamera: () => void;
  /** Pull the camera in front of a freshly-clicked node. */
  focusNode: (node: NetworkNode) => void;
}

interface NetworkGraph3DProps {
  nodes: NetworkNode[];
  links: NetworkLink[];
  width: number;
  height: number;
  theme: NetworkThemeColors;
  isFocused: boolean;
  onNodeClick: (node: NetworkNode) => void;
}

export const NetworkGraph3D = forwardRef<NetworkGraph3DHandle, NetworkGraph3DProps>(
  function NetworkGraph3D(
    { nodes, links, width, height, theme, isFocused, onNodeClick },
    handleRef,
  ) {
    const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
    const animationRef = useRef<number | null>(null);

    // ---- Imperative API exposed to the orchestrator -------------------

    const resetCamera = useCallback(() => {
      const g = fgRef.current;
      if (!g) return;
      g.cameraPosition(
        { x: 0, y: 0, z: CAMERA_DISTANCE },
        { x: 0, y: 0, z: 0 },
        800,
      );
    }, []);

    const focusNode = useCallback((node: NetworkNode) => {
      const g = fgRef.current;
      if (!g) return;
      const dist = node.type === "zone_target" ? 180 : 100;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const z = node.z ?? 0;
      const r = Math.hypot(x, y, z) || 1;
      const ratio = 1 + dist / r;

      g.cameraPosition(
        {
          x: x * ratio || 0,
          y: y * ratio || 40,
          z: z * ratio || dist,
        },
        { x, y, z },
        800,
      );
    }, []);

    useImperativeHandle(handleRef, () => ({ resetCamera, focusNode }), [
      resetCamera,
      focusNode,
    ]);

    // ---- Recenter when fresh data arrives -----------------------------

    // Recenter on a *change* of node count — both deps are listed below.
    // We deliberately do NOT depend on the `nodes` array reference so a
    // realtime tick that returns the same length doesn't fight the
    // user's manual camera moves.
    useEffect(() => {
      if (nodes.length === 0) return;
      const t = setTimeout(resetCamera, 500);
      return () => clearTimeout(t);
    }, [nodes.length, resetCamera]);

    // ---- Auto-rotation while no node is focused -----------------------

    useEffect(() => {
      if (isFocused) return;
      const g = fgRef.current;
      if (!g) return;
      let angle = 0;

      const animate = () => {
        const inst = fgRef.current;
        if (!inst || isFocused) {
          animationRef.current = null;
          return;
        }
        angle += ROTATION_SPEED;
        const x = CAMERA_DISTANCE * Math.sin(angle);
        const z = CAMERA_DISTANCE * Math.cos(angle);
        const y = 30 * Math.sin(angle * 0.4);

        const cam = inst.camera();
        if (cam) {
          const p = cam.position;
          inst.cameraPosition(
            {
              x: p.x + (x - p.x) * ROTATION_LERP,
              y: p.y + (y - p.y) * ROTATION_LERP,
              z: p.z + (z - p.z) * ROTATION_LERP,
            },
            { x: 0, y: 0, z: 0 },
            0,
          );
        }
        animationRef.current = requestAnimationFrame(animate);
      };

      const start = setTimeout(() => {
        animationRef.current = requestAnimationFrame(animate);
      }, ROTATION_START_DELAY_MS);

      return () => {
        clearTimeout(start);
        if (animationRef.current !== null) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = null;
        }
      };
    }, [isFocused]);

    // ---- Styling callbacks -------------------------------------------
    // Each callback bridges the lib's default accessor signature
    // (`NodeObject<{}>` / `LinkObject<{}, {}>`) to our domain types
    // through `asNetworkNode` / `asNetworkLink`.

    const nodeColor = useCallback(
      (raw: NodeObject) => {
        const n = asNetworkNode(raw);
        if (n.type === "zone_target") return theme.zoneTarget;
        if (n.type === "source_post") return theme.sourcePost;
        return theme.avatar;
      },
      [theme],
    );

    const linkColor = useCallback(
      (raw: LinkObject) => {
        const l = asNetworkLink(raw);
        if (l.type === "mentions") return theme.mentionLink;
        const s = l.status as NetworkJobStatus | undefined;
        if (s === "done") return theme.completedLink;
        if (s === "failed") return theme.failedLink;
        return theme.pendingLink;
      },
      [theme],
    );

    const linkWidth = useCallback((raw: LinkObject) => {
      const l = asNetworkLink(raw);
      return l.type === "mentions" ? 0.3 : l.status === "done" ? 1.5 : 0.8;
    }, []);

    const linkParticles = useCallback((raw: LinkObject) => {
      const l = asNetworkLink(raw);
      return l.type === "reply_to" && l.status === "done" ? 2 : 0;
    }, []);

    const nodeLabel = useCallback((raw: NodeObject) => {
      const n = asNetworkNode(raw);
      if (n.type === "zone_target") return `Target: ${n.label}`;
      if (n.type === "source_post") return `Post by ${n.label}`;
      return `Avatar: ${n.label}`;
    }, []);

    const handleClick = useCallback(
      (raw: NodeObject) => onNodeClick(asNetworkNode(raw)),
      [onNodeClick],
    );

    const nodeVal = useCallback(
      (raw: NodeObject) => asNetworkNode(raw).value,
      [],
    );

    if (typeof window === "undefined" || width === 0 || height === 0) return null;

    return (
      <ForceGraph3D
        ref={fgRef}
        width={width}
        height={height}
        graphData={{ nodes, links }}
        nodeLabel={nodeLabel}
        nodeColor={nodeColor}
        nodeVal={nodeVal}
        nodeOpacity={0.92}
        nodeResolution={20}
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkOpacity={0.45}
        linkDirectionalParticles={linkParticles}
        linkDirectionalParticleSpeed={0.003}
        linkDirectionalParticleWidth={1.5}
        linkDirectionalParticleColor={linkColor}
        linkCurvature={0.1}
        backgroundColor="rgba(0,0,0,0)"
        onNodeClick={handleClick}
        enableNodeDrag={false}
        enableNavigationControls
        showNavInfo={false}
        cooldownTicks={120}
      />
    );
  },
);
