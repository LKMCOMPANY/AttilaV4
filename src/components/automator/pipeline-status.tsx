import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Ban,
  Timer,
  AlertCircle,
  AlertTriangle,
  HelpCircle,
  RefreshCw,
  ShieldAlert,
  UserX,
  Filter,
  MessageSquare,
} from "lucide-react";
import type { CampaignJobStatus, CampaignPostStatus } from "@/types";
import {
  parseJobError,
  type JobErrorCategory,
  type JobErrorSeverity,
} from "@/lib/automation/errors";

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

// ---------------------------------------------------------------------------
// Job error category — surfaced when a job is `failed` so operators can act
// ---------------------------------------------------------------------------

interface ErrorCategoryConfig {
  icon: typeof AlertCircle;
  label: string;
  color: string;
  bgColor: string;
}

const SEVERITY_STYLE: Record<JobErrorSeverity, { color: string; bgColor: string }> = {
  action_required: { color: "text-warning", bgColor: "bg-warning/10" },
  transient: { color: "text-muted-foreground", bgColor: "bg-muted/40" },
  terminal: { color: "text-destructive/80", bgColor: "bg-destructive/10" },
  bug: { color: "text-destructive", bgColor: "bg-destructive/15" },
};

const CATEGORY_CONFIG: Record<
  JobErrorCategory,
  Pick<ErrorCategoryConfig, "icon" | "label">
> = {
  container_not_ready: { icon: RefreshCw, label: "Container restart" },
  infrastructure: { icon: RefreshCw, label: "Network / box" },
  device_setup_required: { icon: ShieldAlert, label: "Device setup" },
  consent_required: { icon: ShieldAlert, label: "Consent dialog" },
  account_logged_out: { icon: UserX, label: "Account logged out" },
  account_blocked: { icon: Ban, label: "Account blocked" },
  account_captcha: { icon: ShieldAlert, label: "Captcha" },
  rate_limited: { icon: AlertTriangle, label: "Rate limited" },
  content_unavailable: { icon: XCircle, label: "Post unavailable" },
  ui_unexpected: { icon: HelpCircle, label: "UI unexpected" },
  unknown: { icon: HelpCircle, label: "Unknown error" },
};

function styleFor(category: JobErrorCategory): ErrorCategoryConfig {
  const base = CATEGORY_CONFIG[category];
  const severity = SEVERITY_STYLE[
    {
      container_not_ready: "transient",
      infrastructure: "transient",
      rate_limited: "transient",
      device_setup_required: "action_required",
      consent_required: "action_required",
      account_logged_out: "action_required",
      account_blocked: "action_required",
      account_captcha: "action_required",
      content_unavailable: "terminal",
      ui_unexpected: "bug",
      unknown: "bug",
    }[category] as JobErrorSeverity
  ];
  return { ...base, ...severity };
}

/**
 * Compact pill rendered next to a `failed` job. Tells the operator at a
 * glance whether the device needs human attention, the platform is
 * throttling, or the bug is in our code.
 */
export function JobErrorBadge({
  errorMessage,
  className,
}: {
  errorMessage: string | null | undefined;
  className?: string;
}) {
  const parsed = parseJobError(errorMessage);
  if (!parsed) return null;
  const config = styleFor(parsed.category);
  const Icon = config.icon;
  return (
    <span
      title={parsed.message}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium",
        config.color,
        config.bgColor,
        className,
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {config.label}
    </span>
  );
}
