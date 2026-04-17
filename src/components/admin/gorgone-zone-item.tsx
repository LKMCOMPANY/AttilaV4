"use client";

import { useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { setZonePushEnabled } from "@/app/actions/gorgone";
import { XIcon, TikTokIcon } from "@/components/icons/social-icons";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { GorgoneZoneRow } from "@/types";

const PLATFORM_ICON = {
  twitter: XIcon,
  tiktok: TikTokIcon,
} as const;

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
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
  const Icon = PLATFORM_ICON[row.platform];
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
    <div
      className={cn(
        "flex items-center gap-2 py-1 transition-opacity",
        !row.push_to_attila && "opacity-60"
      )}
    >
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />

      <Badge
        variant={row.push_to_attila ? "default" : "outline"}
        className="h-4 shrink-0 px-1.5 text-[9px] uppercase tracking-wide"
      >
        {row.push_to_attila ? "Live" : "Off"}
      </Badge>

      <span
        className={cn(
          "text-xs tabular-nums",
          total > 0 ? "text-foreground" : "text-muted-foreground/40"
        )}
      >
        {formatCount(total)}
      </span>

      <span className="text-xs text-muted-foreground/70">
        {formatTimeAgo(lastEventAt)}
      </span>

      {lastSource && (
        <span className="rounded bg-muted px-1 text-[9px] uppercase tracking-wide text-muted-foreground/70">
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
  const liveCount = rows.filter((r) => r.push_to_attila).length;

  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{zoneName}</p>
        {liveCount > 0 && (
          <span className="text-[10px] font-medium text-success">
            {liveCount} live
          </span>
        )}
      </div>
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
