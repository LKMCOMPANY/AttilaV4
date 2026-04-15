"use client";

import { useState, useCallback, useTransition, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Calendar,
  Loader2,
} from "lucide-react";
import { XIcon, TikTokIcon } from "@/components/icons/social-icons";
import {
  getCapacityEstimate,
  type CapacityEstimateResult,
  type PlatformCapacityTotals,
} from "@/app/actions/capacity";
import type {
  CampaignFilters,
  CampaignPlatform,
  CapacityParams,
  PlatformCapacityParams,
} from "@/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CapacityEstimatorProps {
  accountId: string;
  zoneId: string;
  platforms: CampaignPlatform[];
  filters: CampaignFilters;
  armyIds: string[];
  capacityParams: CapacityParams;
  onParamsChange?: (params: CapacityParams) => void;
  compact?: boolean;
}

const PLATFORM_LABELS: Record<CampaignPlatform, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  twitter: { label: "X (Twitter)", Icon: XIcon },
  tiktok: { label: "TikTok", Icon: TikTokIcon },
};

export function CapacityEstimator({
  accountId,
  zoneId,
  platforms,
  filters,
  armyIds,
  capacityParams,
  onParamsChange,
  compact = false,
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

  if (!canEstimate) {
    return (
      <EmptyState compact={compact}>
        Select a zone and at least one platform to estimate capacity
      </EmptyState>
    );
  }

  return (
    <div className={cn("space-y-3", compact ? "text-xs" : "text-sm")}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5 text-muted-foreground/60" />
          <h3 className="text-[13px] font-semibold">Capacity Estimator</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchEstimate}
          disabled={isPending}
          className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground"
        >
          {isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-[11px] text-destructive">{error}</p>
        </div>
      )}

      {isPending && !result && (
        <div className="flex items-center justify-center gap-2 py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Estimating volume...</span>
        </div>
      )}

      {result &&
        result.platforms.map((p) => (
          <PlatformBlock
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
            compact={compact}
          />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-platform block
// ---------------------------------------------------------------------------

function PlatformBlock({
  data,
  params,
  onParamsChange,
  compact,
}: {
  data: PlatformCapacityTotals;
  params: PlatformCapacityParams;
  onParamsChange?: (params: PlatformCapacityParams) => void;
  compact: boolean;
}) {
  const { platform, result: r } = data;
  const { Icon, label } = PLATFORM_LABELS[platform];
  const cap = r.capacity;

  const status = getCapacityStatus(cap.avatars_missing, cap.available_avatars);

  const passRatePct = (r.filtered.filter_pass_rate * 100).toFixed(1);

  const handleChange = (field: string, value: number) => {
    if (!onParamsChange || value < 1) return;

    let nextMin = field === "minPerPost" ? value : params.min_avatars_per_post;
    let nextMax = field === "maxPerPost" ? value : params.max_avatars_per_post;
    if (nextMin > nextMax) {
      if (field === "minPerPost") nextMax = nextMin;
      else nextMin = nextMax;
    }

    onParamsChange({
      max_responses_per_hour:
        field === "maxPerHour" ? value : params.max_responses_per_hour,
      max_responses_per_day:
        field === "maxPerDay" ? value : params.max_responses_per_day,
      min_avatars_per_post: nextMin,
      max_avatars_per_post: nextMax,
    });
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-3",
        status === "ok" && "border-success/20 bg-success/[0.03]",
        status === "warning" && "border-warning/20 bg-warning/[0.03]",
        status === "critical" && "border-destructive/20 bg-destructive/[0.03]"
      )}
    >
      {/* Platform header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5" />
          <span className="text-caption">{label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {status === "ok" ? (
            <CheckCircle2 className="h-3 w-3 text-success" />
          ) : (
            <AlertTriangle className={cn("h-3 w-3", status === "warning" ? "text-warning" : "text-destructive")} />
          )}
          <Badge
            variant={status === "ok" ? "secondary" : status === "warning" ? "outline" : "destructive"}
            className="h-4 text-[9px]"
          >
            {status === "ok"
              ? "Sufficient"
              : status === "warning"
                ? "Tight"
                : `${cap.avatars_missing} missing`}
          </Badge>
        </div>
      </div>

      {/* Volume metrics */}
      <div className="grid grid-cols-3 gap-2">
        <Metric
          label="Raw / hour"
          value={formatNumber(r.volume.avg_per_hour)}
          compact={compact}
        />
        <Metric
          label="Filtered / hour"
          value={formatNumber(r.filtered.filtered_per_hour)}
          sub={`${passRatePct}% pass`}
          compact={compact}
        />
        <Metric
          label="Responses / hour"
          value={formatNumber(cap.responses_needed_per_hour)}
          sub={`avg ${cap.avg_avatars_per_post}/post`}
          compact={compact}
        />
      </div>

      {/* Filters breakdown */}
      {r.filtered.filters_applied.length > 0 && (
        <div className="space-y-0.5">
          {r.filtered.filters_applied.map((f, i) => (
            <div key={i} className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">{f.name}</span>
              <span className="tabular-nums text-foreground">
                {(f.pass_rate * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-border/50" />

      {/* Capacity params */}
      <div className="grid grid-cols-2 gap-2">
        <ParamField
          icon={<Clock className="h-3 w-3" />}
          label="Max resp. / avatar / h"
          value={params.max_responses_per_hour}
          onChange={(v) => handleChange("maxPerHour", v)}
          readOnly={!onParamsChange}
          compact={compact}
        />
        <ParamField
          icon={<Calendar className="h-3 w-3" />}
          label="Max resp. / avatar / day"
          value={params.max_responses_per_day}
          onChange={(v) => handleChange("maxPerDay", v)}
          readOnly={!onParamsChange}
          compact={compact}
        />
        <ParamField
          icon={<TrendingDown className="h-3 w-3" />}
          label="Min avatars / post"
          value={params.min_avatars_per_post}
          onChange={(v) => handleChange("minPerPost", v)}
          readOnly={!onParamsChange}
          compact={compact}
        />
        <ParamField
          icon={<TrendingUp className="h-3 w-3" />}
          label="Max avatars / post"
          value={params.max_avatars_per_post}
          onChange={(v) => handleChange("maxPerPost", v)}
          readOnly={!onParamsChange}
          compact={compact}
        />
      </div>

      <div className="border-t border-border/50" />

      {/* Avatar capacity results */}
      <div className="grid grid-cols-3 gap-2">
        <Metric
          label="Available"
          value={String(cap.available_avatars)}
          sub={`/ ${cap.total_avatars} total`}
          compact={compact}
        />
        <Metric
          label="Needed"
          value={String(cap.avatars_needed)}
          sub={cap.bottleneck === "hourly" ? "hourly limit" : "daily limit"}
          compact={compact}
        />
        <Metric
          label={cap.avatars_missing > 0 ? "Missing" : "Surplus"}
          value={
            cap.avatars_missing > 0
              ? `-${cap.avatars_missing}`
              : `+${cap.available_avatars - cap.avatars_needed}`
          }
          highlight={cap.avatars_missing > 0 ? "destructive" : "success"}
          compact={compact}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function Metric({
  label,
  value,
  sub,
  highlight,
  compact,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: "destructive" | "success";
  compact?: boolean;
}) {
  return (
    <div>
      <p
        className={cn(
          "font-semibold tabular-nums",
          compact ? "text-sm" : "text-lg",
          highlight === "destructive" && "text-destructive",
          highlight === "success" && "text-success"
        )}
      >
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      {sub && <p className="text-[9px] text-muted-foreground/60">{sub}</p>}
    </div>
  );
}

function ParamField({
  icon,
  label,
  value,
  onChange,
  readOnly,
  compact,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  onChange: (v: number) => void;
  readOnly?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {icon}
        {label}
      </Label>
      <Input
        type="number"
        min={1}
        value={value}
        onChange={(e) => {
          const v = parseInt(e.target.value);
          if (!isNaN(v) && v >= 1) onChange(v);
        }}
        readOnly={readOnly}
        className={cn("text-xs tabular-nums", compact ? "h-7" : "h-8")}
      />
    </div>
  );
}

function EmptyState({
  children,
  compact,
}: {
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn("rounded-lg border bg-muted/30", compact ? "p-3" : "p-4")}>
      <div className="flex items-center gap-2">
        <BarChart3 className="h-3.5 w-3.5 text-muted-foreground/60" />
        <h3 className="text-[13px] font-semibold">Capacity Estimator</h3>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground/60">{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function getCapacityStatus(
  missing: number,
  available: number
): "ok" | "warning" | "critical" {
  if (missing > 0) return "critical";
  if (available === 0) return "warning";
  return "ok";
}
