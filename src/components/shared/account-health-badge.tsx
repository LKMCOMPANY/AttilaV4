import { Ban, ShieldCheck, ShieldQuestion, UserX } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { isAccountHealthAlarming } from "@/lib/constants/account-health";
import type { AccountHealthStatus, AvatarPlatformHealth } from "@/types";

// ---------------------------------------------------------------------------
// Account health — off-device (TikHub) profile status shown to operators.
// `suspended` / `notfound` are alarming (the account can't publish, which is
// WHY an on-device "done" ends up unconfirmed). `active` is reassuring but
// quiet; `unknown` renders nothing unless explicitly asked (avoids nagging
// while the first probe is still pending / TikHub is disabled).
// ---------------------------------------------------------------------------

const CONFIG: Record<
  AccountHealthStatus,
  { icon: typeof ShieldCheck; label: string; color: string; bgColor: string; dot: string }
> = {
  active: {
    icon: ShieldCheck,
    label: "Live",
    color: "text-success",
    bgColor: "bg-success/10",
    dot: "bg-success",
  },
  suspended: {
    icon: Ban,
    label: "Suspended",
    color: "text-destructive",
    bgColor: "bg-destructive/10",
    dot: "bg-destructive",
  },
  notfound: {
    icon: UserX,
    label: "Not found",
    color: "text-destructive",
    bgColor: "bg-destructive/10",
    dot: "bg-destructive",
  },
  unknown: {
    icon: ShieldQuestion,
    label: "Unchecked",
    color: "text-muted-foreground",
    bgColor: "bg-muted/40",
    dot: "bg-muted-foreground/40",
  },
};

function hint(health: AvatarPlatformHealth): string {
  const parts: string[] = [];
  switch (health.status) {
    case "active":
      parts.push("Account is live on the platform.");
      if (health.followers != null && health.followers > 0) {
        parts.push(`${formatCount(health.followers)} followers.`);
      }
      break;
    case "suspended":
      parts.push("The platform has suspended this account — its posts won't appear.");
      break;
    case "notfound":
      parts.push("This handle no longer resolves (deleted, renamed, or banned).");
      break;
    default:
      parts.push("Account health not checked yet.");
  }
  if (health.checked_at) {
    parts.push(`Checked ${formatDistanceToNow(new Date(health.checked_at), { addSuffix: true })}.`);
  }
  return parts.join(" ");
}

/**
 * Pill with icon + label. By default only alarming statuses render; pass
 * `showActive` (e.g. in the operator credentials panel) to also show the
 * reassuring "Live" / "Unchecked" states.
 */
export function AccountHealthBadge({
  health,
  showActive = false,
  className,
}: {
  health: AvatarPlatformHealth | null | undefined;
  showActive?: boolean;
  className?: string;
}) {
  if (!health) return null;
  if (!showActive && !isAccountHealthAlarming(health.status)) return null;

  const config = CONFIG[health.status];
  const Icon = config.icon;
  return (
    <span
      title={hint(health)}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        config.color,
        config.bgColor,
        className,
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {config.label}
      {showActive && health.status === "active" && (health.followers ?? 0) > 0 && (
        <span className="tabular-nums opacity-70">· {formatCount(health.followers!)}</span>
      )}
    </span>
  );
}

/**
 * Bare dot for dense lists — renders only for alarming statuses so a healthy
 * fleet stays visually quiet.
 */
export function AccountHealthDot({
  health,
  className,
}: {
  health: AvatarPlatformHealth | null | undefined;
  className?: string;
}) {
  if (!health || !isAccountHealthAlarming(health.status)) return null;
  const config = CONFIG[health.status];
  return (
    <span className="flex items-center gap-1" title={hint(health)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot, className)} />
      <span className={cn("text-[9px] font-medium", config.color)}>{config.label}</span>
    </span>
  );
}
