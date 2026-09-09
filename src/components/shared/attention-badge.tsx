import {
  AlertTriangle,
  AppWindow,
  AtSign,
  Boxes,
  Clock,
  Globe,
  HelpCircle,
  KeyRound,
  Keyboard,
  LayoutTemplate,
  LogIn,
  MessageSquareWarning,
  Network,
  Power,
  ServerCrash,
  ShieldQuestion,
  UserX,
  Hand,
  ArrowDownToLine,
  MailWarning,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ATTENTION_SEVERITY_META,
  ATTENTION_STATUS_META,
  attentionReasonMeta,
  type AttentionTone,
} from "@/lib/presentation/attention";
import type { AttentionQueueItem, AttentionReason, AttentionSeverity, AttentionStatus } from "@/types";

// ---------------------------------------------------------------------------
// Attention queue — visual layer over the shared vocabulary
// (`lib/presentation/attention.ts`). Tone → colour is the same mapping the
// macOS client applies (`AttentionTone.tint`): critical = destructive, watch =
// warning, info = info, muted = muted foreground.
// ---------------------------------------------------------------------------

const TONE_CLASS: Record<AttentionTone, { text: string; bg: string }> = {
  critical: { text: "text-destructive", bg: "bg-destructive/10" },
  watch: { text: "text-warning", bg: "bg-warning/10" },
  info: { text: "text-info", bg: "bg-info/10" },
  muted: { text: "text-muted-foreground", bg: "bg-muted/40" },
};

type Glyph = typeof AlertTriangle;

/** Indexed directly at render (a lookup, never a component created in render). */
const REASON_ICON: Record<AttentionReason | string, Glyph> = {
  needs_login: LogIn,
  captcha: ShieldQuestion,
  sms_verification: MessageSquareWarning,
  suspended_decision: Hand,
  credentials_missing: KeyRound,
  account_missing: UserX,
  handle_invalid: AtSign,
  persona_device_mismatch: Globe,
  app_outdated: ArrowDownToLine,
  app_missing: AppWindow,
  adbkeyboard_missing: Keyboard,
  proxy_incoherent: Network,
  timezone_incoherent: Clock,
  boot_dead: Power,
  dialog_unknown: LayoutTemplate,
  container_untracked: Boxes,
  box_unreachable: ServerCrash,
  email_code: MailWarning,
  manual: Hand,
};

/** Reason pill: icon + label, tinted by the reason's tone. */
export function AttentionReasonBadge({ reason, className }: { reason: string; className?: string }) {
  const meta = attentionReasonMeta(reason);
  const tone = TONE_CLASS[meta.tone];
  const Icon = REASON_ICON[reason] ?? HelpCircle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        tone.text,
        tone.bg,
        className,
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {meta.label}
    </span>
  );
}

export function AttentionSeverityBadge({ severity, className }: { severity: AttentionSeverity; className?: string }) {
  const meta = ATTENTION_SEVERITY_META[severity];
  const tone = TONE_CLASS[meta.tone];
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", tone.text, tone.bg, className)}>
      {meta.label}
    </span>
  );
}

export function AttentionStatusBadge({ status, className }: { status: AttentionStatus; className?: string }) {
  const meta = ATTENTION_STATUS_META[status];
  const tone = TONE_CLASS[meta.tone];
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", tone.text, tone.bg, className)}>
      {meta.label}
    </span>
  );
}

/**
 * Dense roster signal: the worst open item's reason, tinted by its tone, with
 * the count when there are several — only renders when the list is non-empty,
 * so a quiet fleet stays quiet.
 */
export function AttentionSignal({ items, className }: { items: AttentionQueueItem[]; className?: string }) {
  if (items.length === 0) return null;
  const worst = items.reduce((top, item) => (SEVERITY_RANK[item.severity] > SEVERITY_RANK[top.severity] ? item : top));
  const meta = attentionReasonMeta(worst.reason);
  const tone = TONE_CLASS[meta.tone];
  const Icon = REASON_ICON[worst.reason] ?? HelpCircle;
  return (
    <span className={cn("flex items-center gap-1", className)} title={items.map((item) => item.title).join("\n")}>
      <Icon className={cn("h-2.5 w-2.5", tone.text)} />
      <span className={cn("text-[9px] font-medium", tone.text)}>
        {meta.label}
        {items.length > 1 && <span className="tabular-nums opacity-70"> +{items.length - 1}</span>}
      </span>
    </span>
  );
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = { info: 0, warning: 1, critical: 2 };
