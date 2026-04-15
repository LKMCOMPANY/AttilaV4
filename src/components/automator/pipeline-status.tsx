import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Ban,
  Timer,
} from "lucide-react";
import type { CampaignJobStatus } from "@/types";

const STATUS_CONFIG: Record<
  CampaignJobStatus,
  { icon: typeof Clock; color: string; iconExtra?: string; label: string }
> = {
  done: { icon: CheckCircle2, color: "text-success", label: "Done" },
  failed: { icon: XCircle, color: "text-destructive", label: "Failed" },
  executing: { icon: Loader2, color: "text-primary", iconExtra: "animate-spin", label: "Running" },
  cancelled: { icon: Ban, color: "text-muted-foreground/50", label: "Cancelled" },
  expired: { icon: Timer, color: "text-warning/60", label: "Expired" },
  ready: { icon: Clock, color: "text-muted-foreground", label: "Ready" },
};

export function JobStatusIcon({
  status,
  className,
}: {
  status: CampaignJobStatus;
  className?: string;
}) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <Icon
      className={cn("h-3 w-3 shrink-0", config.color, config.iconExtra, className)}
    />
  );
}

export function JobStatusLabel({ status }: { status: CampaignJobStatus }) {
  return (
    <span
      className={cn(
        "text-[10px] font-medium",
        STATUS_CONFIG[status].color
      )}
    >
      {STATUS_CONFIG[status].label}
    </span>
  );
}
