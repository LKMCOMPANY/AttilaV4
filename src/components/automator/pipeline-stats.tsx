"use client";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Campaign } from "@/types";

interface PipelineStatsProps {
  campaign: Campaign;
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
    tooltip: "Comments confirmed live on the platform",
    highlight: "text-success" as const,
  },
  {
    key: "total_responses_failed" as const,
    label: "Failed",
    tooltip: "Comments that could not be published (after retries)",
    highlight: "text-destructive" as const,
  },
] as const;

export function PipelineStats({ campaign }: PipelineStatsProps) {
  const sent = campaign.total_responses_sent;
  const failed = campaign.total_responses_failed;
  const attempted = sent + failed;
  const successRate = attempted > 0 ? Math.round((sent / attempted) * 100) : null;

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
    </div>
  );
}
