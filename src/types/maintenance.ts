/**
 * Wire types of the avatar-maintenance layer (migration 20260909163649 and
 * later). Mirrored field-for-field by `AttilaModels` in the macOS client; any
 * change here is a change there in the same phase.
 */

import type { SocialPlatform } from "./index";

// ---------------------------------------------------------------------------
// Attention queue — what a human must do, at three scopes
// ---------------------------------------------------------------------------

export const ATTENTION_SCOPES = ["avatar_platform", "device", "box"] as const;
export type AttentionScope = (typeof ATTENTION_SCOPES)[number];

export const ATTENTION_SEVERITIES = ["info", "warning", "critical"] as const;
export type AttentionSeverity = (typeof ATTENTION_SEVERITIES)[number];

export const ATTENTION_STATUSES = [
  "open",
  "in_progress",
  "done_pending_reprobe",
  "resolved",
  "reopened",
] as const;
export type AttentionStatus = (typeof ATTENTION_STATUSES)[number];

export const ATTENTION_SOURCES = [
  "maintainer",
  "executor",
  "health_worker",
  "reconcile",
  "operator",
] as const;
export type AttentionSource = (typeof ATTENTION_SOURCES)[number];

/**
 * Why a human is needed. Account scope: needs_login, captcha, sms_verification,
 * suspended_decision, credentials_missing, account_missing, handle_invalid,
 * persona_device_mismatch. Device scope: app_outdated, app_missing,
 * adbkeyboard_missing, proxy_incoherent, timezone_incoherent, boot_dead,
 * dialog_unknown, container_untracked. Box scope: box_unreachable.
 */
export const ATTENTION_REASONS = [
  "needs_login",
  "captcha",
  "sms_verification",
  "suspended_decision",
  "credentials_missing",
  "account_missing",
  "handle_invalid",
  "persona_device_mismatch",
  "app_outdated",
  "app_missing",
  "adbkeyboard_missing",
  "proxy_incoherent",
  "timezone_incoherent",
  "boot_dead",
  "dialog_unknown",
  "container_untracked",
  "box_unreachable",
  "manual",
] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

export interface AttentionItem {
  id: string;
  account_id: string;
  scope: AttentionScope;
  avatar_id: string | null;
  platform: SocialPlatform | null;
  device_id: string | null;
  box_id: string | null;
  reason: AttentionReason | string;
  severity: AttentionSeverity;
  title: string;
  detail: string | null;
  evidence: AttentionEvidence;
  source: AttentionSource;
  status: AttentionStatus;
  reopen_count: number;
  block_id: string | null;
  reprobe_task_id: string | null;
  opened_at: string;
  last_seen_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  done_by: string | null;
  done_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Row of `attention_queue_v`: the item plus its server-computed priority. */
export interface AttentionQueueItem extends AttentionItem {
  priority: number;
}

/** Free-form but conventional keys; proofs are storage paths, never URLs. */
export interface AttentionEvidence {
  screen_state?: string;
  proof_path?: string;
  tikhub_status?: string;
  observed?: string;
  expected?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// App versions per device
// ---------------------------------------------------------------------------

export const APP_VERSION_SOURCES = ["online_v2", "offline_packages_xml"] as const;
export type AppVersionSource = (typeof APP_VERSION_SOURCES)[number];

export interface DeviceAppVersion {
  device_id: string;
  package: string;
  version_name: string | null;
  version_code: number | null;
  checked_at: string;
  source: AppVersionSource;
}

// ---------------------------------------------------------------------------
// Ledger of avatar actions — one row per real action, per local day
// ---------------------------------------------------------------------------

export const AVATAR_ACTION_KINDS = [
  "like",
  "follow",
  "unfollow",
  "comment",
  "reply",
  "post",
  "repost",
  "login",
  "search",
  "session",
  "dm",
] as const;
export type AvatarActionKind = (typeof AVATAR_ACTION_KINDS)[number];

export const AVATAR_ACTORS = ["automator", "maintainer", "operator"] as const;
export type AvatarActor = (typeof AVATAR_ACTORS)[number];

export interface AvatarAction {
  id: string;
  account_id: string;
  avatar_id: string;
  platform: SocialPlatform;
  action: AvatarActionKind;
  actor: AvatarActor;
  occurred_at: string;
  local_date: string;
  ref_kind: "campaign_job" | "maintenance_task" | "manual" | null;
  ref_id: string | null;
  target: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Runtime settings — operating switches and budgets
// ---------------------------------------------------------------------------

export const MAINTENANCE_MODES = ["observe", "supervised", "autonomous"] as const;
export type MaintenanceMode = (typeof MAINTENANCE_MODES)[number];

export type RuntimeSettingKey =
  | "maintenance.mode"
  | "maintenance.global_enabled"
  | "tikhub.daily_call_budget"
  | "aleria.daily_budget_usd"
  | "maintenance.proof_retention_days"
  | "audit_log.retention_days";

export interface RuntimeSetting {
  key: RuntimeSettingKey | string;
  value: unknown;
  updated_at: string;
  updated_by: string | null;
}
