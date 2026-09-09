import type {
  AttentionReason,
  AttentionScope,
  AttentionSeverity,
  AttentionSource,
  AttentionStatus,
} from "@/types";

// ---------------------------------------------------------------------------
// Attention queue — presentation vocabulary shared by both clients.
//
// One label and one semantic tone per wire value, so the web and the macOS
// client tell the same story with the same words. The Swift side
// (`AttentionPresentation.swift`) mirrors this file exactly; both are pinned
// to `__fixtures__/attention-vocabulary.json` by a test. Framework-free on
// purpose: colours and icons live in the components.
// ---------------------------------------------------------------------------

/** Semantic tone → colour: critical = danger, watch = warning, info = info, muted = muted. */
export type AttentionTone = "critical" | "watch" | "info" | "muted";

export interface AttentionMeta {
  label: string;
  tone: AttentionTone;
}

export const ATTENTION_REASON_META: Record<AttentionReason, AttentionMeta> = {
  needs_login: { label: "Needs login", tone: "critical" },
  captcha: { label: "Captcha", tone: "critical" },
  sms_verification: { label: "SMS verification", tone: "critical" },
  suspended_decision: { label: "Suspended — decision needed", tone: "critical" },
  credentials_missing: { label: "Credentials missing", tone: "watch" },
  account_missing: { label: "No account", tone: "info" },
  handle_invalid: { label: "Handle to fix", tone: "watch" },
  persona_device_mismatch: { label: "Persona ≠ device", tone: "watch" },
  app_outdated: { label: "App out of date", tone: "watch" },
  app_missing: { label: "App missing", tone: "watch" },
  adbkeyboard_missing: { label: "ADBKeyboard missing", tone: "watch" },
  proxy_incoherent: { label: "Proxy mismatch", tone: "watch" },
  timezone_incoherent: { label: "Timezone mismatch", tone: "watch" },
  boot_dead: { label: "Won't boot", tone: "critical" },
  dialog_unknown: { label: "Unknown dialog", tone: "watch" },
  container_untracked: { label: "Untracked container", tone: "info" },
  box_unreachable: { label: "Box unreachable", tone: "critical" },
  manual: { label: "Manual", tone: "info" },
};

export const ATTENTION_SEVERITY_META: Record<AttentionSeverity, AttentionMeta> = {
  info: { label: "Info", tone: "info" },
  warning: { label: "Warning", tone: "watch" },
  critical: { label: "Critical", tone: "critical" },
};

export const ATTENTION_STATUS_META: Record<AttentionStatus, AttentionMeta> = {
  open: { label: "Open", tone: "watch" },
  in_progress: { label: "In progress", tone: "info" },
  done_pending_reprobe: { label: "Done — verifying", tone: "info" },
  resolved: { label: "Resolved", tone: "muted" },
  reopened: { label: "Reopened", tone: "critical" },
};

export const ATTENTION_SCOPE_LABEL: Record<AttentionScope, string> = {
  avatar_platform: "Account",
  device: "Device",
  box: "Box",
};

export const ATTENTION_SOURCE_LABEL: Record<AttentionSource, string> = {
  maintainer: "Maintainer",
  executor: "Automator",
  health_worker: "Health check",
  reconcile: "Reconcile",
  operator: "Operator",
};

/** Tone of a reason this build does not know — the server may add reasons first. */
export const UNKNOWN_REASON_TONE: AttentionTone = "muted";

function isKnownReason(reason: string): reason is AttentionReason {
  return reason in ATTENTION_REASON_META;
}

/**
 * Presentation of a reason, tolerant of values newer than this build: an
 * unknown reason is humanised (`some_new_reason` → "Some new reason") and
 * rendered muted rather than crashing the queue.
 */
export function attentionReasonMeta(reason: string): AttentionMeta {
  if (isKnownReason(reason)) return ATTENTION_REASON_META[reason];
  const humanised = reason.replace(/_/g, " ").trim();
  return {
    label: humanised ? humanised.charAt(0).toUpperCase() + humanised.slice(1) : "Unknown",
    tone: UNKNOWN_REASON_TONE,
  };
}
