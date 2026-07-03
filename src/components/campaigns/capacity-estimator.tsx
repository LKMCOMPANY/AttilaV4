"use client";

import { useState, useCallback, useTransition, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";
import { BarChart3, RefreshCw, Loader2 } from "lucide-react";
import {
  getCapacityEstimate,
  type CapacityEstimateResult,
} from "@/app/actions/capacity";
import { CapacityPlatformBlock } from "./capacity-platform-block";
import type {
  CampaignFilters,
  CampaignPlatform,
  CapacityParams,
} from "@/types";

/**
 * Capacity panel container: debounced fetch of the zone volume + filter
 * simulation + army capacity, one card per platform. Rendering lives in
 * `capacity-platform-block.tsx`.
 */

interface CapacityEstimatorProps {
  accountId: string;
  zoneId: string;
  platforms: CampaignPlatform[];
  filters: CampaignFilters;
  armyIds: string[];
  capacityParams: CapacityParams;
  onParamsChange?: (params: CapacityParams) => void;
}

export function CapacityEstimator({
  accountId,
  zoneId,
  platforms,
  filters,
  armyIds,
  capacityParams,
  onParamsChange,
}: CapacityEstimatorProps) {
  const [result, setResult] = useState<CapacityEstimateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const canEstimate = zoneId && platforms.length > 0;

  const inputKey = JSON.stringify({
    zoneId,
    platforms,
    filters,
    armyIds,
    capacityParams,
  });

  const fetchEstimate = useCallback(() => {
    if (!canEstimate) return;

    startTransition(async () => {
      const { data, error: err } = await getCapacityEstimate({
        zone_id: zoneId,
        platforms,
        filters,
        army_ids: armyIds,
        capacity_params: capacityParams,
        account_id: accountId,
      });

      if (err) {
        setError(err);
        setResult(null);
      } else {
        setError(null);
        setResult(data);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey, canEstimate, accountId]);

  useEffect(() => {
    if (!canEstimate) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchEstimate, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchEstimate, canEstimate]);

  const header = (
    <div className="mb-2.5 flex items-center gap-2">
      <BarChart3 className="h-3.5 w-3.5 text-muted-foreground/60" />
      <h3 className="flex items-center gap-1 text-[13px] font-semibold">
        Capacity
        <InfoTip side="right">
          Estimates the zone&apos;s hourly volume from its last 24h of
          collection, simulates your filters on real posts, and checks the
          selected armies can produce the required responses. Updates as
          you edit filters, armies, or limits.
        </InfoTip>
      </h3>
      <div className="flex-1" />
      {canEstimate && (
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchEstimate}
          disabled={isPending}
          className="h-5 gap-1 px-1.5 text-[10px] text-muted-foreground"
        >
          {isPending ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : (
            <RefreshCw className="h-2.5 w-2.5" />
          )}
          Refresh
        </Button>
      )}
    </div>
  );

  if (!canEstimate) {
    return (
      <div>
        {header}
        <div className="rounded-md border p-2.5">
          <p className="text-[10px] text-muted-foreground">
            Select a zone and at least one platform to estimate capacity
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {header}
      <div
        className={cn(
          "space-y-2.5 transition-opacity duration-200",
          // Keep stale numbers readable (and params editable) while a
          // refetch is in flight, but make the transient state visible.
          isPending && result && "opacity-60",
        )}
      >
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5">
            <p className="text-[10px] text-destructive">
              Estimation failed: {error}
            </p>
            <button
              type="button"
              onClick={fetchEstimate}
              className="mt-0.5 text-[10px] font-medium text-destructive underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        )}

        {!result && !error && platforms.map((p) => <CapacitySkeleton key={p} />)}

        {result &&
          result.platforms.map((p) => (
            <CapacityPlatformBlock
              key={p.platform}
              data={p}
              params={capacityParams[p.platform]}
              onParamsChange={
                onParamsChange
                  ? (patch) =>
                      onParamsChange({
                        ...capacityParams,
                        [p.platform]: patch,
                      })
                  : undefined
              }
            />
          ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton — matches CapacityPlatformBlock structure
// ---------------------------------------------------------------------------

function CapacitySkeleton() {
  return (
    <div className="rounded-md border p-2.5">
      {/* Header with estimating indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-3 w-3 rounded" />
          <Skeleton className="h-3 w-16" />
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60">
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
          Estimating
        </span>
      </div>

      {/* Metrics placeholder */}
      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        {[10, 14, 12].map((w, i) => (
          <div key={i} className="space-y-1">
            <Skeleton className="h-3.5" style={{ width: `${w * 4}px` }} />
            <Skeleton className="h-2.5 w-14" />
          </div>
        ))}
      </div>

      <div className="my-2.5 border-t border-border/50" />

      {/* Params placeholder */}
      <div className="grid grid-cols-2 gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-1">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-7 w-full rounded-md" />
          </div>
        ))}
      </div>

      <div className="my-2.5 border-t border-border/50" />

      {/* Capacity result placeholder */}
      <div className="grid grid-cols-3 gap-1.5">
        {[8, 10, 12].map((w, i) => (
          <div key={i} className="space-y-1">
            <Skeleton className="h-3.5" style={{ width: `${w * 4}px` }} />
            <Skeleton className="h-2.5 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
