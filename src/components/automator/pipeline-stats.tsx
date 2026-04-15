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
    label: "Ingested",
    tooltip: "Posts ingested from data source",
  },
  {
    key: "total_posts_filtered" as const,
    label: "Filtered",
    tooltip: "Posts filtered out by AI analyst",
  },
  {
    key: "total_responses_sent" as const,
    label: "Sent",
    tooltip: "Responses successfully posted",
    highlight: "text-success" as const,
  },
  {
    key: "total_responses_failed" as const,
    label: "Failed",
    tooltip: "Responses that failed to post",
    highlight: "text-destructive" as const,
  },
] as const;

export function PipelineStats({ campaign }: PipelineStatsProps) {
  return (
    <div className="grid grid-cols-4 border-b">
      {METRICS.map((m) => {
        const value = campaign[m.key];
        const hasHighlight = "highlight" in m && value > 0;

        return (
          <Tooltip key={m.key}>
            <TooltipTrigger
              render={
                <div className="flex flex-col items-center px-2 py-2.5" />
              }
            >
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums leading-none",
                  hasHighlight ? m.highlight : "text-foreground"
                )}
              >
                {value.toLocaleString()}
              </span>
              <span className="mt-1 text-[9px] uppercase tracking-wide text-muted-foreground">
                {m.label}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {m.tooltip}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
