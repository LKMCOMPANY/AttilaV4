"use client";

import { useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { RefreshCw, Loader2 } from "lucide-react";
import { toggleZoneSync, triggerManualSync } from "@/app/actions/gorgone";
import { toast } from "sonner";
import type { GorgoneSyncCursor } from "@/types";

const STATUS_BADGE: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  idle: { label: "Idle", variant: "secondary" },
  syncing: { label: "Syncing", variant: "default" },
  error: { label: "Error", variant: "destructive" },
};

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

// ---------------------------------------------------------------------------
// Single cursor row (one platform for a zone)
// ---------------------------------------------------------------------------

interface CursorRowProps {
  cursor: GorgoneSyncCursor;
  onUpdated: () => void;
}

function CursorRow({ cursor, onUpdated }: CursorRowProps) {
  const [isSyncing, startSyncTransition] = useTransition();
  const [isToggling, startToggleTransition] = useTransition();

  const statusConfig = STATUS_BADGE[cursor.status] ?? STATUS_BADGE.idle;
  const platformIcon = cursor.platform === "twitter" ? "𝕏" : "♪";

  function handleToggle(checked: boolean) {
    startToggleTransition(async () => {
      const result = await toggleZoneSync({ cursorId: cursor.id, isActive: checked });
      if (result.error) toast.error(result.error);
      onUpdated();
    });
  }

  function handleSync() {
    startSyncTransition(async () => {
      const result = await triggerManualSync({ cursorId: cursor.id });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Synced ${result.synced} ${cursor.platform === "twitter" ? "tweets" : "videos"}`);
      }
      onUpdated();
    });
  }

  return (
    <div className="flex items-center gap-2 py-1">
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-bold"
        title={cursor.platform}
      >
        {platformIcon}
      </span>

      <Badge variant={statusConfig.variant} className="shrink-0 text-[10px]">
        {statusConfig.label}
      </Badge>

      <span className="text-xs text-muted-foreground">
        {formatTimeAgo(cursor.last_synced_at)}
      </span>
      <span className="text-xs text-muted-foreground">
        {formatCount(cursor.total_synced)}
      </span>

      {cursor.error_message && (
        <span className="max-w-[120px] truncate text-xs text-destructive" title={cursor.error_message}>
          {cursor.error_message}
        </span>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <Switch
          size="sm"
          checked={cursor.is_active}
          onCheckedChange={handleToggle}
          disabled={isToggling}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleSync}
          disabled={isSyncing || !cursor.is_active}
          title="Sync now"
        >
          {isSyncing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grouped zone item (groups cursors by zone_name)
// ---------------------------------------------------------------------------

interface GorgoneZoneGroupProps {
  zoneName: string;
  cursors: GorgoneSyncCursor[];
  onUpdated: () => void;
}

export function GorgoneZoneGroup({ zoneName, cursors, onUpdated }: GorgoneZoneGroupProps) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-sm font-medium">{zoneName}</p>
      <div className="mt-1 divide-y">
        {cursors.map((cursor) => (
          <CursorRow key={cursor.id} cursor={cursor} onUpdated={onUpdated} />
        ))}
      </div>
    </div>
  );
}
