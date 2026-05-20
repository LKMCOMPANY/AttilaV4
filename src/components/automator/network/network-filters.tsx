"use client";

import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type {
  NetworkNodeFilters,
  NetworkStatusFilters,
} from "@/types/network";

/**
 * Filter UI for the network map.
 *
 * Two independent groups: node-type toggles (targets/posts/avatars) and
 * job-status toggles (done/failed/pending) on `reply_to` links.
 *
 * Lives in its own module so the orchestrator (`campaign-network-map.tsx`)
 * can stay focused on data fetching + camera state, and so the legend +
 * filter switches can be reused or unit-tested in isolation.
 */

interface NetworkFiltersProps {
  nodeFilters: NetworkNodeFilters;
  statusFilters: NetworkStatusFilters;
  onNodeFiltersChange: (filters: NetworkNodeFilters) => void;
  onStatusFiltersChange: (filters: NetworkStatusFilters) => void;
}

export function NetworkFilters({
  nodeFilters,
  statusFilters,
  onNodeFiltersChange,
  onStatusFiltersChange,
}: NetworkFiltersProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" className="h-7 w-7" />}
      >
        <Filter className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent className="w-52" align="end" sideOffset={8}>
        <div className="space-y-4">
          <p className="text-label">Filters</p>

          <div className="space-y-2.5">
            <p className="text-caption">Nodes</p>
            <FilterSwitch
              id="f-targets"
              label="Targets"
              dotClass="bg-foreground"
              checked={nodeFilters.zoneTargets}
              onChange={(v) =>
                onNodeFiltersChange({ ...nodeFilters, zoneTargets: v })
              }
            />
            <FilterSwitch
              id="f-posts"
              label="Posts"
              dotClass="bg-muted-foreground"
              checked={nodeFilters.sourcePosts}
              onChange={(v) =>
                onNodeFiltersChange({ ...nodeFilters, sourcePosts: v })
              }
            />
            <FilterSwitch
              id="f-avatars"
              label="Avatars"
              dotClass="bg-primary"
              checked={nodeFilters.avatars}
              onChange={(v) =>
                onNodeFiltersChange({ ...nodeFilters, avatars: v })
              }
            />
          </div>

          <div className="space-y-2.5">
            <p className="text-caption">Job Status</p>
            <FilterSwitch
              id="f-done"
              label="Done"
              dotClass="bg-primary"
              checked={statusFilters.done}
              onChange={(v) =>
                onStatusFiltersChange({ ...statusFilters, done: v })
              }
            />
            <FilterSwitch
              id="f-failed"
              label="Failed"
              dotClass="bg-destructive"
              checked={statusFilters.failed}
              onChange={(v) =>
                onStatusFiltersChange({ ...statusFilters, failed: v })
              }
            />
            <FilterSwitch
              id="f-pending"
              label="Pending"
              dotClass="bg-muted-foreground/50"
              checked={statusFilters.pending}
              onChange={(v) =>
                onStatusFiltersChange({ ...statusFilters, pending: v })
              }
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Legend strip — sits below the WebGL canvas in the orchestrator.
// ---------------------------------------------------------------------------

export function NetworkLegend() {
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-5 border-t border-border/40 px-4 py-1.5 glass-effect">
      <LegendDot color="bg-foreground" label="Target" />
      <LegendDot color="bg-muted-foreground" label="Posts" />
      <LegendDot color="bg-primary" label="Avatars" />
      <span className="h-3 w-px bg-border" />
      <LegendDot color="bg-primary" label="Done" size="sm" />
      <LegendDot color="bg-destructive" label="Failed" size="sm" />
    </div>
  );
}

function LegendDot({
  color,
  label,
  size = "md",
}: {
  color: string;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "rounded-full",
          color,
          size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2",
        )}
      />
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function FilterSwitch({
  id,
  label,
  dotClass,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  dotClass: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label htmlFor={id} className="flex items-center gap-2 text-body-sm">
        <span className={cn("h-2 w-2 rounded-full", dotClass)} />
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
