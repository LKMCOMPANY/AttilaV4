import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Ban,
  Timer,
  AlertCircle,
  UserX,
  Filter,
  MessageSquare,
} from "lucide-react";
import type { CampaignJobStatus, CampaignPostStatus } from "@/types";

// ---------------------------------------------------------------------------
// Job statuses
// ---------------------------------------------------------------------------

const JOB_STATUS_CONFIG: Record<
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
  const config = JOB_STATUS_CONFIG[status];
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
        JOB_STATUS_CONFIG[status].color
      )}
    >
      {JOB_STATUS_CONFIG[status].label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Post statuses
// ---------------------------------------------------------------------------

const POST_STATUS_CONFIG: Record<
  CampaignPostStatus,
  { icon: typeof Clock; color: string; bgColor: string; iconExtra?: string; label: string }
> = {
  responded: { icon: MessageSquare, color: "text-success", bgColor: "bg-success/10", label: "Responded" },
  awaiting_avatars: { icon: UserX, color: "text-warning", bgColor: "bg-warning/10", label: "Awaiting avatars" },
  filtered_out: { icon: Filter, color: "text-muted-foreground/60", bgColor: "bg-muted/30", label: "Filtered" },
  error: { icon: AlertCircle, color: "text-destructive", bgColor: "bg-destructive/10", label: "Error" },
  pending: { icon: Clock, color: "text-muted-foreground", bgColor: "bg-muted/30", label: "Pending" },
  processing: { icon: Loader2, color: "text-primary", bgColor: "bg-primary/10", iconExtra: "animate-spin", label: "Processing" },
};

export function PostStatusBadge({
  status,
  className,
}: {
  status: CampaignPostStatus;
  className?: string;
}) {
  const config = POST_STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium",
        config.color,
        config.bgColor,
        className
      )}
    >
      <Icon className={cn("h-2.5 w-2.5", config.iconExtra)} />
      {config.label}
    </span>
  );
}
