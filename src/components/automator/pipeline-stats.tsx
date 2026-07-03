"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ShieldCheck,
  ShieldQuestion,
  Clock,
  Wrench,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { InfoTip } from "@/components/ui/info-tip";
import { SocialIcon } from "@/components/icons/social-icons";
import { categoryLabel } from "./pipeline-status";
import { getCampaignStats, type CampaignStats } from "@/app/actions/pipeline";
import type { Campaign, SocialPlatform } from "@/types";

interface PipelineStatsProps {
  campaign: Campaign;
  /** Bumps on realtime pipeline events — triggers a breakdown refetch. */
  pipelineVersion?: number;
}

const METRICS = [
  {
    key: "total_posts_ingested" as const,
    label: "Engaged",
    tooltip: "Posts the AI judged relevant — responses were generated",
  },
  {
    key: "total_posts_filtered" as const,
    label: "Skipped",
    tooltip: "Posts filtered out (rules or AI) — no response needed",
  },
  {
    key: "total_responses_sent" as const,
    label: "Published",
    tooltip: "Comments confirmed sent on the device",
    highlight: "text-success" as const,
  },
  {
    key: "total_responses_failed" as const,
    label: "Failed",
    tooltip: "Comments that could not be published (after retries)",
    highlight: "text-destructive" as const,
  },
] as const;

export function PipelineStats({ campaign, pipelineVersion }: PipelineStatsProps) {
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [open, setOpen] = useState(false);

  // Live job breakdown (network / verification / failures). Refetched on every
  // realtime pipeline tick so the panel tracks the campaign as it runs.
  useEffect(() => {
    let alive = true;
    getCampaignStats(campaign.id).then((s) => {
      if (alive) setStats(s);
    });
    return () => {
      alive = false;
    };
  }, [campaign.id, pipelineVersion]);

  const sent = campaign.total_responses_sent;
  const failed = campaign.total_responses_failed;
  const attempted = sent + failed;
  const successRate = attempted > 0 ? Math.round((sent / attempted) * 100) : null;

  const actionRequired = stats?.buckets.action_required ?? 0;

  return (
    <div className="shrink-0 border-b">
      <div className="grid grid-cols-4">
        {METRICS.map((m) => {
          const value = campaign[m.key];
          const hasHighlight = "highlight" in m && value > 0;
          return (
            <Tooltip key={m.key}>
              <TooltipTrigger
                render={<div className="flex flex-col items-center px-2 py-3" />}
              >
                <span
                  className={cn(
                    "text-lg font-semibold tabular-nums leading-none tracking-tight",
                    hasHighlight ? m.highlight : "text-foreground",
                  )}
                >
                  {value.toLocaleString()}
                </span>
                <span className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {m.label}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-52 text-xs">
                {m.tooltip}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {successRate !== null && (
        <div className="flex items-center gap-2 border-t bg-muted/20 px-3 py-1.5">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-destructive/15">
            <div
              className="h-full rounded-full bg-success transition-[width] duration-500"
              style={{ width: `${successRate}%` }}
            />
          </div>
          <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
            {successRate}% published
          </span>
        </div>
      )}

      {/* Always-visible operator alert: failures only THEY can clear. */}
      {actionRequired > 0 && (
        <div className="flex items-center gap-1.5 border-t border-warning/20 bg-warning/10 px-3 py-1.5">
          <Wrench className="h-3 w-3 shrink-0 text-warning" />
          <span className="text-[11px] font-medium text-warning">
            {actionRequired} to fix
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            — logged-out accounts or un-provisioned devices need you
          </span>
        </div>
      )}

      {/* Collapsible breakdown — kept out of the default view so it doesn't
          eat the list height; the critical alert above is always visible. */}
      {stats && (stats.totalDone > 0 || stats.totalFailed > 0 || stats.totalPending > 0) && (
        <div className="border-t">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/40"
          >
            <ChevronDown
              className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
            />
            {open ? "Hide breakdown" : "Breakdown by network, quality & errors"}
            {stats.totalPending > 0 && (
              <span className="ml-auto inline-flex items-center gap-1 tabular-nums text-muted-foreground/70">
                <Clock className="h-2.5 w-2.5" />
                {stats.totalPending} live
              </span>
            )}
          </button>

          {open && <StatsBreakdown stats={stats} />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Breakdown — per-network, verification quality, failure buckets
// ---------------------------------------------------------------------------

function StatsBreakdown({ stats }: { stats: CampaignStats }) {
  const networks = stats.networks.filter((n) => n.done + n.failed + n.pending > 0);
  const v = stats.verification;
  const hasVerification = v.confirmed + v.unconfirmed > 0;

  return (
    <div className="space-y-3 bg-muted/10 px-3 pb-3 pt-1">
      {/* Per-network */}
      {networks.length > 0 && (
        <Section label="By network">
          <div className="space-y-1.5">
            {networks.map((n) => (
              <NetworkRow key={n.platform} network={n} />
            ))}
          </div>
        </Section>
      )}

      {/* Verification quality — only when TikHub has produced a verdict */}
      {hasVerification && (
        <Section
          label="Delivery quality"
          hint="Independent TikHub confirmation of published posts"
        >
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <QualityStat
              icon={ShieldCheck}
              color="text-success"
              value={v.confirmed}
              label="confirmed"
            />
            {v.unconfirmed > 0 && (
              <QualityStat
                icon={ShieldQuestion}
                color="text-warning"
                value={v.unconfirmed}
                label="unconfirmed"
              />
            )}
            {v.unchecked > 0 && (
              <QualityStat
                icon={Clock}
                color="text-muted-foreground"
                value={v.unchecked}
                label="checking"
              />
            )}
          </div>
        </Section>
      )}

      {/* Failures grouped by what the operator should do */}
      {stats.totalFailed > 0 && (
        <Section label="Failures">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <BucketStat value={stats.buckets.action_required} label="to fix" color="text-warning" />
            <BucketStat value={stats.buckets.transient} label="auto-retried" color="text-muted-foreground" />
            <BucketStat value={stats.buckets.terminal} label="post gone" color="text-muted-foreground" />
            <BucketStat value={stats.buckets.bug} label="unexpected" color="text-destructive" />
          </div>
          {stats.failures.length > 0 && (
            <div className="mt-1.5 space-y-1 border-t border-border/40 pt-1.5">
              {stats.failures.slice(0, 5).map((f) => (
                <div
                  key={f.category}
                  className="flex items-center justify-between gap-2 text-[11px]"
                >
                  <span
                    className={cn(
                      "truncate",
                      f.severity === "action_required" && "text-warning",
                      f.severity === "bug" && "text-destructive",
                      (f.severity === "transient" || f.severity === "terminal") &&
                        "text-muted-foreground",
                    )}
                  >
                    {categoryLabel(f.category)}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {f.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

function NetworkRow({
  network,
}: {
  network: CampaignStats["networks"][number];
}) {
  const total = network.done + network.failed + network.pending;
  const donePct = total > 0 ? (network.done / total) * 100 : 0;
  const failPct = total > 0 ? (network.failed / total) * 100 : 0;

  return (
    <div className="flex items-center gap-2">
      <SocialIcon
        platform={network.platform as SocialPlatform}
        className="h-3 w-3 shrink-0 text-muted-foreground"
      />
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="flex h-full">
          <div className="h-full bg-success" style={{ width: `${donePct}%` }} />
          <div className="h-full bg-destructive/70" style={{ width: `${failPct}%` }} />
        </div>
      </div>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
        <span className="font-medium text-success">{network.done}</span>
        {" · "}
        <span className="font-medium text-destructive">{network.failed}</span>
        {network.pending > 0 && (
          <>
            {" · "}
            <span className="text-muted-foreground">{network.pending}</span>
          </>
        )}
      </span>
    </div>
  );
}

function QualityStat({
  icon: Icon,
  color,
  value,
  label,
}: {
  icon: typeof ShieldCheck;
  color: string;
  value: number;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px]">
      <Icon className={cn("h-3 w-3", color)} />
      <span className={cn("font-semibold tabular-nums", color)}>{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function BucketStat({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  if (value === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px]">
      <span className={cn("font-semibold tabular-nums", color)}>{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
          {label}
        </span>
        {hint && <InfoTip side="right">{hint}</InfoTip>}
      </div>
      {children}
    </div>
  );
}
