"use client";

import { cn } from "@/lib/utils";
import type { RealtimeConnectionStatus } from "@/hooks/use-realtime-campaign";

const STATUS_CONFIG: Record<
  RealtimeConnectionStatus,
  { color: string; label: string }
> = {
  connected: { color: "bg-success", label: "Live" },
  connecting: { color: "bg-warning animate-pulse", label: "Connecting" },
  disconnected: { color: "bg-muted-foreground/40", label: "Offline" },
};

export function RealtimeIndicator({
  status,
}: {
  status: RealtimeConnectionStatus;
}) {
  const config = STATUS_CONFIG[status];

  return (
    <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1.5 rounded-full bg-background/80 px-2 py-0.5 backdrop-blur-sm">
      <span className={cn("h-1.5 w-1.5 rounded-full", config.color)} />
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {config.label}
      </span>
    </div>
  );
}
