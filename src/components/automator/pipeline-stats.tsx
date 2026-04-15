"use client";

import { cn } from "@/lib/utils";
import {
  Inbox,
  FilterX,
  MessageSquareCheck,
  AlertTriangle,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
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
    icon: Inbox,
    color: "text-info",
  },
  {
    key: "total_posts_filtered" as const,
    label: "Filtered",
    tooltip: "Posts filtered out by AI analyst",
    icon: FilterX,
    color: "text-muted-foreground",
  },
  {
    key: "total_responses_sent" as const,
    label: "Sent",
    tooltip: "Responses successfully posted",
    icon: MessageSquareCheck,
    color: "text-success",
  },
  {
    key: "total_responses_failed" as const,
    label: "Failed",
    tooltip: "Responses that failed to post",
    icon: AlertTriangle,
    color: "text-destructive",
  },
] as const;

export function PipelineStats({ campaign }: PipelineStatsProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="grid grid-cols-4 gap-px border-b bg-border">
        {METRICS.map((m) => {
          const Icon = m.icon;
          const value = campaign[m.key];

          return (
            <Tooltip key={m.key}>
              <TooltipTrigger asChild>
                <div className="flex flex-col items-center gap-0.5 bg-background px-2 py-2">
                  <div className="flex items-center gap-1">
                    <Icon className={cn("h-3 w-3", m.color)} />
                    <span className="text-xs font-semibold tabular-nums">
                      {value.toLocaleString()}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {m.label}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {m.tooltip}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
