import { Badge } from "@/components/ui/badge";
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

const STATUS_ICON_MAP: Record<
  CampaignJobStatus,
  { icon: typeof Clock; className: string }
> = {
  done: { icon: CheckCircle2, className: "text-success" },
  failed: { icon: XCircle, className: "text-destructive" },
  executing: { icon: Loader2, className: "animate-spin text-info" },
  cancelled: { icon: Ban, className: "text-muted-foreground/50" },
  expired: { icon: Timer, className: "text-warning/60" },
  ready: { icon: Clock, className: "text-warning" },
};

const BADGE_VARIANT_MAP: Record<
  CampaignJobStatus,
  "default" | "destructive" | "secondary"
> = {
  done: "default",
  failed: "destructive",
  executing: "secondary",
  cancelled: "secondary",
  expired: "secondary",
  ready: "secondary",
};

export function JobStatusIcon({
  status,
  className,
}: {
  status: CampaignJobStatus;
  className?: string;
}) {
  const config = STATUS_ICON_MAP[status];
  const Icon = config.icon;
  return (
    <Icon
      className={cn("h-3.5 w-3.5 shrink-0", config.className, className)}
    />
  );
}

export function JobStatusBadge({
  status,
  className,
}: {
  status: CampaignJobStatus;
  className?: string;
}) {
  return (
    <Badge
      variant={BADGE_VARIANT_MAP[status]}
      className={cn("text-[9px] capitalize", className)}
    >
      {status}
    </Badge>
  );
}
