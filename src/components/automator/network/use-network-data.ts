"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getNetworkData } from "@/app/actions/network";
import type { NetworkData } from "@/types/network";

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
      setData(result.data);
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
