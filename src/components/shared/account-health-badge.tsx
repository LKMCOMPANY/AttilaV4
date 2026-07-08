import {
  Ban,
  HelpCircle,
  LogOut,
  PencilLine,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import {
  ACCOUNT_HEALTH_META,
  isAlarmingKind,
  type AccountHealthKind,
  type AccountHealthTone,
} from "@/lib/constants/account-health";
import type { AvatarPlatformHealth } from "@/types";

// ---------------------------------------------------------------------------
// Account health — visual layer over the derived `AccountHealthKind`.
// Two confidence tiers carry through the colours:
//   critical (red) = we're sure (saw the login/block screen, or the platform
//   says suspended); watch (amber) = probable (handle doesn't resolve, or posts
//   aren't being confirmed = likely shadow-ban). `live`/`unchecked` stay quiet.
// ---------------------------------------------------------------------------

const ICON: Record<AccountHealthKind, typeof ShieldCheck> = {
  logged_out: LogOut,
  suspended: Ban,
  blocked: ShieldAlert,
  captcha: ShieldAlert,
  unresolved: HelpCircle,
  handle_mismatch: PencilLine,
  shadow_ban: ShieldQuestion,
  live: ShieldCheck,
  unchecked: ShieldQuestion,
};

const TONE_CLASS: Record<AccountHealthTone, { text: string; bg: string; dot: string }> = {
  critical: { text: "text-destructive", bg: "bg-destructive/10", dot: "bg-destructive" },
  watch: { text: "text-warning", bg: "bg-warning/10", dot: "bg-warning" },
  ok: { text: "text-success", bg: "bg-success/10", dot: "bg-success" },
  muted: { text: "text-muted-foreground", bg: "bg-muted/40", dot: "bg-muted-foreground/40" },
};

/** Full tooltip: the kind's explanation + platform context (followers / age). */
function tooltip(kind: AccountHealthKind, health: AvatarPlatformHealth | null): string {
  const parts = [ACCOUNT_HEALTH_META[kind].hint];
  if (kind === "live" && (health?.followers ?? 0) > 0) {
    parts.push(`${formatCount(health!.followers!)} followers.`);
  }
  if (health?.checked_at) {
    parts.push(`Checked ${formatDistanceToNow(new Date(health.checked_at), { addSuffix: true })}.`);
  }
  return parts.join(" ");
}

/**
 * Pill with icon + label. By default only alarming kinds (critical / watch)
 * render; pass `showOk` (e.g. the operator credentials panel) to also show the
 * reassuring `Live` / `Unchecked` states.
 */
export function AccountHealthBadge({
  kind,
  health,
  showOk = false,
  className,
}: {
  kind: AccountHealthKind;
  health?: AvatarPlatformHealth | null;
  showOk?: boolean;
  className?: string;
}) {
  if (!showOk && !isAlarmingKind(kind)) return null;

  const meta = ACCOUNT_HEALTH_META[kind];
  const tone = TONE_CLASS[meta.tone];
  const Icon = ICON[kind];
  return (
    <span
      title={tooltip(kind, health ?? null)}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        tone.text,
        tone.bg,
        className,
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {meta.label}
      {showOk && kind === "live" && (health?.followers ?? 0) > 0 && (
        <span className="tabular-nums opacity-70">· {formatCount(health!.followers!)}</span>
      )}
    </span>
  );
}

/**
 * Bare dot + short label for dense lists — renders only for alarming kinds so a
 * healthy fleet stays visually quiet.
 */
export function AccountHealthDot({
  kind,
  health,
  className,
}: {
  kind: AccountHealthKind;
  health?: AvatarPlatformHealth | null;
  className?: string;
}) {
  if (!isAlarmingKind(kind)) return null;
  const meta = ACCOUNT_HEALTH_META[kind];
  const tone = TONE_CLASS[meta.tone];
  return (
    <span className="flex items-center gap-1" title={tooltip(kind, health ?? null)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot, className)} />
      <span className={cn("text-[9px] font-medium", tone.text)}>{meta.label}</span>
    </span>
  );
}
