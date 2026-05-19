"use client";

import { useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { setZoneSubscription } from "@/app/actions/gorgone";
import { XIcon, TikTokIcon } from "@/components/icons/social-icons";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { GorgoneZoneRow, GorgoneNetwork } from "@/types";

const PLATFORM_ICON: Partial<Record<GorgoneNetwork, typeof XIcon>> = {
  twitter: XIcon,
  tiktok: TikTokIcon,
};

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
  /**
   * Other (network) rows for the same zone — needed because the toggle
   * writes the whole `networks[]` array on the Gorgone subscription;
   * we have to know what's currently active to avoid wiping siblings.
   */
  zoneRows: GorgoneZoneRow[];
  onUpdated: () => void;
}

function ZoneRow({ row, zoneRows, onUpdated }: ZoneRowProps) {
  const [isToggling, startToggle] = useTransition();
  const Icon = PLATFORM_ICON[row.network];
  const total = row.total_received;

  function handleToggle(checked: boolean) {
    // Recompute the full networks array we want on Gorgone side.
    const currentlyActive = new Set(
      zoneRows.filter((r) => r.is_subscribed).map((r) => r.network),
    );
    if (checked) currentlyActive.add(row.network);
    else currentlyActive.delete(row.network);
    const networks = [...currentlyActive];

    startToggle(async () => {
      const result = await setZoneSubscription({
        zoneId: row.zone_id,
        isActive: networks.length > 0,
        networks,
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
        !row.is_subscribed && "opacity-60",
      )}
    >
      {Icon ? (
        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
      ) : (
        <span className="h-3 w-3 shrink-0" />
      )}

      <Badge
        variant={row.is_subscribed ? "default" : "outline"}
        className="h-4 shrink-0 px-1.5 text-[9px] uppercase tracking-wide"
      >
        {row.is_subscribed ? "Live" : "Off"}
      </Badge>

      {!row.has_active_rule && (
        <Badge
          variant="outline"
          className="h-4 shrink-0 border-warning/40 px-1.5 text-[9px] uppercase tracking-wide text-warning"
          title="No active monitoring rule on Gorgone for this network"
          aria-label={`No active rule on Gorgone for ${row.network}`}
        >
          No rule
        </Badge>
      )}

      <span
        className={cn(
          "text-xs tabular-nums",
          total > 0 ? "text-foreground" : "text-muted-foreground/40",
        )}
      >
        {formatCount(total)}
      </span>

      <span className="text-xs text-muted-foreground/70">
        {formatTimeAgo(row.last_event_at)}
      </span>

      <div
        className="ml-auto"
        title={
          row.is_subscribed
            ? `Disable ${row.network} push for this zone (kill switch)`
            : `Re-enable ${row.network} push for this zone`
        }
      >
        <Switch
          size="sm"
          checked={row.is_subscribed}
          onCheckedChange={handleToggle}
          disabled={isToggling}
          aria-label={`${row.is_subscribed ? "Disable" : "Enable"} ${row.network} push for ${row.zone_name}`}
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
  const liveCount = rows.filter((r) => r.is_subscribed).length;

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
            key={`${row.zone_id}:${row.network}`}
            row={row}
            zoneRows={rows}
            onUpdated={onUpdated}
          />
        ))}
      </div>
    </div>
  );
}
