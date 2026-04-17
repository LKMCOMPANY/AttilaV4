"use client";

import { useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { setZonePushEnabled } from "@/app/actions/gorgone";
import { toast } from "sonner";
import type { GorgoneZoneRow } from "@/types";

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

interface ZoneRowProps {
  row: GorgoneZoneRow;
  onUpdated: () => void;
}

function ZoneRow({ row, onUpdated }: ZoneRowProps) {
  const [isToggling, startToggle] = useTransition();
  const platformIcon = row.platform === "twitter" ? "𝕏" : "♪";
  const total = row.state?.total_received ?? 0;
  const lastEventAt = row.state?.last_event_at ?? null;
  const lastSource = row.state?.last_event_source;

  function handleToggle(checked: boolean) {
    startToggle(async () => {
      const result = await setZonePushEnabled({
        zoneId: row.zone_id,
        enabled: checked,
      });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(checked ? "Push enabled" : "Push disabled");
      }
      onUpdated();
    });
  }

  return (
    <div className="flex items-center gap-2 py-1">
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-bold"
        title={row.platform}
      >
        {platformIcon}
      </span>

      <Badge
        variant={row.push_to_attila ? "default" : "outline"}
        className="shrink-0 text-[10px]"
      >
        {row.push_to_attila ? "Live" : "Off"}
      </Badge>

      <span className="text-xs text-muted-foreground tabular-nums">
        {formatCount(total)}
      </span>
      <span className="text-xs text-muted-foreground">
        {formatTimeAgo(lastEventAt)}
      </span>
      {lastSource && (
        <span className="text-[10px] uppercase text-muted-foreground/70">
          {lastSource}
        </span>
      )}

      <div className="ml-auto">
        <Switch
          size="sm"
          checked={row.push_to_attila}
          onCheckedChange={handleToggle}
          disabled={isToggling}
        />
      </div>
    </div>
  );
}

interface GorgoneZoneGroupProps {
  zoneName: string;
  rows: GorgoneZoneRow[];
  onUpdated: () => void;
}

export function GorgoneZoneGroup({ zoneName, rows, onUpdated }: GorgoneZoneGroupProps) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-sm font-medium">{zoneName}</p>
      <div className="mt-1 divide-y">
        {rows.map((row) => (
          <ZoneRow
            key={`${row.zone_id}:${row.platform}`}
            row={row}
            onUpdated={onUpdated}
          />
        ))}
      </div>
    </div>
  );
}
