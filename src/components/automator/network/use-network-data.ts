"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getNetworkData } from "@/app/actions/network";
import type { NetworkData, NetworkNode } from "@/types/network";

const FALLBACK_POLL_INTERVAL = 120_000;

export interface NetworkDataState {
  data: NetworkData | null;
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  /**
   * Force-refetch — used by the Retry button on error and by the
   * fullscreen toolbar's "Center View" sibling. Initial load + realtime
   * + fallback poll are wired up internally by the hook.
   */
  refresh: () => Promise<void>;
}

/**
 * Owns the network-graph dataset for a single campaign:
 *   - first-page fetch on mount + on realtime ticks + on a 2-min fallback,
 *   - request-id guard so an in-flight call is dropped when a newer one
 *     starts (prevents stale results clobbering fresh state),
 *   - encapsulates the setState-after-await pattern so the consumer
 *     component stays free of `react-hooks/set-state-in-effect` noise.
 *
 * Mirrors the shape of `use-pipeline-data.ts` so both surfaces share a
 * predictable lifecycle for operators reading the code.
 */
export function useNetworkData(
  campaignId: string,
  pipelineVersion?: number,
): NetworkDataState {
  const [data, setData] = useState<NetworkData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    const result = await getNetworkData(campaignId);
    if (requestId !== requestRef.current) return;
    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      // Warm-start the force layout: carry the previous nodes' simulated
      // positions/velocities into the fresh dataset by id. Without this, every
      // realtime tick / poll hands react-force-graph brand-new node objects and
      // it re-runs the whole simulation from random positions — the graph
      // "explodes" and re-settles on screen, which is both jarring and a CPU
      // spike. Only genuinely new nodes fly in; everything else stays put.
      const next = result.data;
      setData((prev) => mergeGraphPositions(prev, next));
      setError(null);
    }
    setIsLoading(false);
    setIsFetching(false);
  }, [campaignId]);

  // The three effects below sync this hook with an *external* system —
  // the Gorgone-fed pipeline — by calling `refresh` (which writes to
  // state only after an awaited network round-trip and only when the
  // request-id guard above proves it's the freshest call). React 19's
  // `set-state-in-effect` lint can't follow the indirection, so we
  // silence it locally with an explanatory disable. Same posture as the
  // sibling `use-pipeline-data.ts` and `use-realtime-campaign.ts` hooks.

  // Initial load.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  // Realtime-triggered refresh.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (pipelineVersion && pipelineVersion > 0) refresh();
  }, [pipelineVersion, refresh]);

  // Long-interval fallback poll (safety net) — runs `refresh` on a
  // timer; `setInterval` is async by nature so the lint doesn't fire.
  useEffect(() => {
    const interval = setInterval(refresh, FALLBACK_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [refresh]);

  return { data, isLoading, isFetching, error, refresh };
}

// ---------------------------------------------------------------------------
// Position-preserving merge — keeps the layout stable across refetches.
// ---------------------------------------------------------------------------

/** Runtime layout fields react-force-graph writes onto each node in place. */
type SimPosition = Partial<
  Record<"x" | "y" | "z" | "vx" | "vy" | "vz", number>
>;

function mergeGraphPositions(
  prev: NetworkData | null,
  next: NetworkData,
): NetworkData {
  if (!prev) return next;

  const prevById = new Map(prev.nodes.map((node) => [node.id, node]));
  const nodes = next.nodes.map((node) => {
    const old = prevById.get(node.id) as (NetworkNode & SimPosition) | undefined;
    if (!old || old.x === undefined) return node; // new node → let the sim place it
    return {
      ...node,
      x: old.x,
      y: old.y,
      z: old.z,
      vx: old.vx,
      vy: old.vy,
      vz: old.vz,
    };
  });

  return { ...next, nodes };
}
