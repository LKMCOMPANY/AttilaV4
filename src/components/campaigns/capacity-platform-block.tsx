"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { InfoTip } from "@/components/ui/info-tip";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatCount, formatRate } from "@/lib/format";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  CircleSlash,
  Clock,
  FilterX,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { XIcon, TikTokIcon } from "@/components/icons/social-icons";
import type { PlatformCapacityTotals } from "@/app/actions/capacity";
import type {
  TwitterBreakdown,
  TiktokBreakdown,
} from "@/lib/gorgone";
import type { CampaignPlatform, PlatformCapacityParams } from "@/types";

/**
 * Per-platform capacity card: volume → filter impact → army capacity.
 * Pure display + params editing; data fetching lives in
 * `capacity-estimator.tsx`.
 */

const PLATFORM_LABELS: Record<
  CampaignPlatform,
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  twitter: { label: "X (Twitter)", Icon: XIcon },
  tiktok: { label: "TikTok", Icon: TikTokIcon },
};

export function CapacityPlatformBlock({
  data,
  params,
  onParamsChange,
}: {
  data: PlatformCapacityTotals;
  params: PlatformCapacityParams;
  onParamsChange?: (params: PlatformCapacityParams) => void;
}) {
  const { platform, result: r } = data;
  const { Icon, label } = PLATFORM_LABELS[platform];
  const cap = r.capacity;

  const status = getCapacityStatus(r);
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
    <div className="space-y-2.5 rounded-md border p-2.5">
      {/* Platform header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3 w-3 text-muted-foreground" />
          <span className="text-[11px] font-medium">{label}</span>
        </div>
        <StatusBadge status={status} missing={cap.avatars_missing} />
      </div>

      {/* Volume metrics — `formatRate` keeps a fractional decimal under 1k
          so the on-screen arithmetic stays self-consistent
          (e.g. "3.5/h × 1.5 = 5.3/h" instead of misleading "4 × 1.5 = 5"). */}
      <div className="grid grid-cols-3 gap-1.5">
        <Metric
          label="Raw / h"
          value={formatRate(r.volume.avg_per_hour)}
          tip="Everything the Gorgone zone collects per hour on this network (posts, replies, comments…) — the campaign's incoming stream before any filter."
        />
        <Metric
          label="Filtered / h"
          value={formatRate(r.filtered.filtered_per_hour)}
          sub={`${passRatePct}% pass`}
          tip={`Posts per hour left after your filters. Measured by running the campaign's real filters on the ${formatCount(r.volume.sample_size)} most recent posts — identical logic to the live pipeline.`}
        />
        <Metric
          label="Resp. / h"
          value={formatRate(cap.responses_needed_per_hour)}
          sub={`avg ${cap.avg_avatars_per_post}/post`}
          tip="Responses your avatars must produce per hour: Filtered/h × average avatars per post."
        />
      </div>

      {/* Zone snapshot — what the incoming stream is made of */}
      <ZoneSnapshot breakdown={r.volume.breakdown} byLanguage={r.volume.by_language} sampleSize={r.volume.sample_size} />

      {/* Filter impact */}
      {r.filtered.filters_applied.length > 0 && (
        <div className="space-y-1 rounded-md bg-muted/40 px-2 py-1.5">
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
              Filter impact
            </span>
            <InfoTip>
              Share of posts each filter lets through, measured one filter
              at a time on the sample. The combined line runs them all
              together — filters overlap, so it is not the product of the
              individual rates.
            </InfoTip>
          </div>
          {r.filtered.filters_applied.map((f) => (
            <div key={f.key} className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">{f.label}</span>
              <span className="tabular-nums">{(f.pass_rate * 100).toFixed(1)}%</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-border/50 pt-1 text-[10px] font-medium">
            <span>All filters combined</span>
            <span className="tabular-nums">{passRatePct}%</span>
          </div>
        </div>
      )}

      <div className="border-t border-border/50" />

      {/* Capacity params */}
      <div className="grid grid-cols-2 gap-1.5">
        <ParamField
          icon={<Clock className="h-2.5 w-2.5" />}
          label="Max / avatar / h"
          tip="Safety cap: how many responses one avatar may post per hour on this network. Raising it increases throughput and detection risk."
          value={params.max_responses_per_hour}
          onChange={(v) => handleChange("maxPerHour", v)}
          readOnly={!onParamsChange}
        />
        <ParamField
          icon={<Calendar className="h-2.5 w-2.5" />}
          label="Max / avatar / day"
          tip="Daily cap per avatar. Whichever of the hourly or daily limit is hit first becomes the bottleneck."
          value={params.max_responses_per_day}
          onChange={(v) => handleChange("maxPerDay", v)}
          readOnly={!onParamsChange}
        />
        <ParamField
          icon={<TrendingDown className="h-2.5 w-2.5" />}
          label="Min avatars / post"
          tip="Each matched post receives at least this many avatar responses."
          value={params.min_avatars_per_post}
          onChange={(v) => handleChange("minPerPost", v)}
          readOnly={!onParamsChange}
        />
        <ParamField
          icon={<TrendingUp className="h-2.5 w-2.5" />}
          label="Max avatars / post"
          tip="Upper bound of avatar responses per matched post. The estimate uses the midpoint of min and max."
          value={params.max_avatars_per_post}
          onChange={(v) => handleChange("maxPerPost", v)}
          readOnly={!onParamsChange}
        />
      </div>

      <div className="border-t border-border/50" />

      {/* Avatar capacity results — `formatCount` keeps integer scaling
          consistent with the rest of the count grid. */}
      <div className="grid grid-cols-3 gap-1.5">
        <Metric
          label="Available"
          value={formatCount(cap.available_avatars)}
          sub={`/ ${formatCount(cap.total_avatars)} total`}
          tip={`Active avatars in the selected armies with ${label} enabled. The denominator counts enabled avatars in any status.`}
        />
        <Metric
          label="Needed"
          value={formatCount(cap.avatars_needed)}
          sub={cap.bottleneck === "hourly" ? "hourly limit" : "daily limit"}
          tip={`Avatars required to cover ${formatRate(cap.responses_needed_per_hour)} responses/h (${formatRate(cap.responses_needed_per_day)}/day) at the caps configured above. The ${cap.bottleneck} cap is the constraint.`}
        />
        <Metric
          label={cap.avatars_missing > 0 ? "Missing" : "Surplus"}
          value={
            cap.avatars_missing > 0
              ? `−${formatCount(cap.avatars_missing)}`
              : `+${formatCount(cap.available_avatars - cap.avatars_needed)}`
          }
          highlight={cap.avatars_missing > 0 ? "destructive" : "success"}
          tip={
            cap.avatars_missing > 0
              ? "Add avatars to the selected armies (or lower filters / avatars-per-post) to cover the demand."
              : "Spare avatars beyond what the current volume requires."
          }
        />
      </div>

      {/* Provenance footnote */}
      <p className="text-[9px] leading-relaxed text-muted-foreground/60">
        Based on {formatCount(r.volume.total_posts)} posts over the last{" "}
        {r.volume.window.effective_hours}h of collection
        {r.volume.sample_size > 0 &&
          r.volume.sample_size < r.volume.total_posts &&
          ` · stats sampled on the ${formatCount(r.volume.sample_size)} most recent`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zone snapshot — composition of the incoming stream
// ---------------------------------------------------------------------------

function ZoneSnapshot({
  breakdown,
  byLanguage,
  sampleSize,
}: {
  breakdown: TwitterBreakdown | TiktokBreakdown;
  byLanguage: Record<string, number>;
  sampleSize: number;
}) {
  if (sampleSize === 0) return null;

  const rows =
    breakdown.platform === "twitter"
      ? twitterSnapshotRows(breakdown)
      : tiktokSnapshotRows(breakdown);
  const langs = topLanguages(byLanguage, sampleSize, 3);

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1">
        <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
          Zone snapshot
        </span>
        <InfoTip>
          Composition of the raw stream over the estimation window — use it
          to pick filters (e.g. language codes) that match what the zone
          actually collects.
        </InfoTip>
      </div>
      {rows.map((row) => (
        <p key={row} className="text-[10px] leading-snug text-muted-foreground">
          {row}
        </p>
      ))}
      {langs && (
        <p className="text-[10px] leading-snug text-muted-foreground">
          Languages: {langs}
        </p>
      )}
    </div>
  );
}

function twitterSnapshotRows(b: TwitterBreakdown): string[] {
  return [
    `Original ${b.pct_original}% · Replies ${b.pct_replies}% · Reposts ${b.pct_retweets}%`,
    `Verified authors ${b.pct_verified_authors}% · Avg engagement ${formatCount(b.avg_engagement)} · Avg views ${formatCount(b.avg_views)}`,
  ];
}

function tiktokSnapshotRows(b: TiktokBreakdown): string[] {
  return [
    `Videos ${b.pct_videos}% (${formatCount(b.videos)}) · Comments ${b.pct_comments}% (${formatCount(b.comments)})`,
    `Ads ${b.pct_ads}% · Private authors ${b.pct_private_authors}% · Verified ${b.pct_verified_authors}%`,
    `Avg plays ${formatCount(b.avg_play_count)} · Avg engagement ${formatCount(b.avg_engagement)} (videos)`,
  ];
}

function topLanguages(
  byLanguage: Record<string, number>,
  sampleSize: number,
  top: number,
): string | null {
  const entries = Object.entries(byLanguage).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  const shown = entries
    .slice(0, top)
    .map(([lang, n]) => `${lang} ${Math.round((n / sampleSize) * 100)}%`)
    .join(" · ");
  const rest = entries.length - top;
  return rest > 0 ? `${shown} · +${rest} more` : shown;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

type CapacityStatus = "ok" | "no_traffic" | "no_match" | "tight" | "missing";

function getCapacityStatus(r: PlatformCapacityTotals["result"]): CapacityStatus {
  if (r.volume.total_posts === 0) return "no_traffic";
  if (
    r.filtered.filters_applied.length > 0 &&
    r.filtered.filter_pass_rate === 0
  ) {
    return "no_match";
  }
  if (r.capacity.avatars_missing > 0) return "missing";

  // Coverage headroom: capacity vs demand on the binding limit.
  const cap = r.capacity;
  if (cap.responses_needed_per_hour > 0 && cap.capacity_per_hour > 0) {
    const coverage = Math.min(
      cap.capacity_per_hour / cap.responses_needed_per_hour,
      cap.capacity_per_day / cap.responses_needed_per_day,
    );
    if (coverage < 1.2) return "tight";
  }
  return "ok";
}

const STATUS_CONFIG: Record<
  CapacityStatus,
  {
    label: (missing: number) => string;
    variant: "secondary" | "outline" | "destructive";
    icon: React.ReactNode;
    badgeClass?: string;
    tip: string;
  }
> = {
  ok: {
    label: () => "Sufficient",
    variant: "secondary",
    icon: <CheckCircle2 className="h-3 w-3 text-success" />,
    tip: "The selected armies cover the estimated demand with headroom.",
  },
  no_traffic: {
    label: () => "No traffic",
    variant: "outline",
    icon: <CircleSlash className="h-3 w-3 text-muted-foreground/70" />,
    badgeClass: "border-muted-foreground/30 text-muted-foreground",
    tip: "The zone collected nothing on this network in its last 24h window. Check the zone's rules and push subscription in the admin.",
  },
  no_match: {
    label: () => "Filters match 0",
    variant: "outline",
    icon: <FilterX className="h-3 w-3 text-warning" />,
    badgeClass: "border-warning/40 text-warning",
    tip: "Your filters rejected every sampled post — the campaign would stay silent. Relax the thresholds below.",
  },
  tight: {
    label: () => "Tight",
    variant: "outline",
    icon: <AlertTriangle className="h-3 w-3 text-warning" />,
    badgeClass: "border-warning/40 text-warning",
    tip: "Capacity covers the demand with less than 20% headroom — a traffic spike will overflow the queue.",
  },
  missing: {
    label: (missing) => `${missing} missing`,
    variant: "destructive",
    icon: <AlertTriangle className="h-3 w-3 text-destructive" />,
    tip: "Not enough active avatars to cover the demand. Add avatars to the armies or lower the volume (filters, avatars per post).",
  },
};

function StatusBadge({
  status,
  missing,
}: {
  status: CapacityStatus;
  missing: number;
}) {
  const config = STATUS_CONFIG[status];
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="inline-flex cursor-help items-center gap-1" />}
      >
        {config.icon}
        <Badge
          variant={config.variant}
          className={cn("h-4 px-1.5 text-[9px]", config.badgeClass)}
        >
          {config.label(missing)}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-60 whitespace-normal leading-relaxed">
        {config.tip}
      </TooltipContent>
    </Tooltip>
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
  tip,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: "destructive" | "success";
  tip?: string;
}) {
  return (
    <div>
      <p
        className={cn(
          "text-xs font-semibold tabular-nums",
          highlight === "destructive" && "text-destructive",
          highlight === "success" && "text-success",
        )}
      >
        {value}
      </p>
      <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {label}
        {tip && <InfoTip>{tip}</InfoTip>}
      </p>
      {sub && <p className="text-[9px] text-muted-foreground/60">{sub}</p>}
    </div>
  );
}

function ParamField({
  icon,
  label,
  tip,
  value,
  onChange,
  readOnly,
}: {
  icon: React.ReactNode;
  label: string;
  tip: string;
  value: number;
  onChange: (v: number) => void;
  readOnly?: boolean;
}) {
  // Stable per-instance id so the Label's htmlFor binds to the Input
  // (screen-reader friendly, click-to-focus on touch devices).
  const inputId = useId();
  return (
    <div className="space-y-0.5">
      <Label
        htmlFor={inputId}
        className="flex items-center gap-1 text-[10px] text-muted-foreground"
      >
        {icon}
        {label}
        <InfoTip>{tip}</InfoTip>
      </Label>
      <Input
        id={inputId}
        type="number"
        min={1}
        value={value}
        onChange={(e) => {
          const v = parseInt(e.target.value);
          if (!isNaN(v) && v >= 1) onChange(v);
        }}
        readOnly={readOnly}
        className="h-7 text-xs tabular-nums"
      />
    </div>
  );
}
