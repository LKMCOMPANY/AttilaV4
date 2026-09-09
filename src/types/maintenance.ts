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
 * dialog_unknown, container_untracked. Box scope: box_unreachable. Account
 * scope, phase 2: email_code (a login code was sent and never arrived).
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
  "email_code",
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

// ---------------------------------------------------------------------------
// Phase 1 — the twin, the task queue, the profiles and the briefs
// (migration 20260909200000)
// ---------------------------------------------------------------------------

/** What the device last showed for one account (`avatar_platform_state`). */
export const ON_DEVICE_STATUSES = [
  "unknown",
  "logged_in",
  "logged_out",
  "challenge",
  "suspended",
  "app_missing",
  "app_outdated",
  "unreadable",
] as const;
export type OnDeviceStatus = (typeof ON_DEVICE_STATUSES)[number];

export interface AvatarPlatformState {
  avatar_id: string;
  platform: SocialPlatform;
  on_device_status: OnDeviceStatus;
  last_screen_state: string | null;
  probed_at: string | null;
  last_session_at: string | null;
  last_login_at: string | null;
  followers_seen: number | null;
  following_seen: number | null;
  notes: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const MAINTENANCE_TASK_KINDS = [
  "probe",
  "warmup",
  "dismiss_dialogs",
  "coherence",
  "app_check",
  "social_session",
  "relogin",
] as const;
export type MaintenanceTaskKind = (typeof MAINTENANCE_TASK_KINDS)[number];

export const MAINTENANCE_TASK_STATUSES = ["scheduled", "running", "done", "failed", "skipped", "cancelled"] as const;
export type MaintenanceTaskStatus = (typeof MAINTENANCE_TASK_STATUSES)[number];

export type MaintenanceTaskCreator = "scheduler" | "operator" | "attention_reprobe" | "system";

/** One journaled step of a task; `proof_path` is a `maintenance-proofs` storage path. */
export interface MaintenanceStep {
  name: string;
  at: string;
  duration_ms: number;
  outcome: "ok" | "skipped" | "failed";
  screen_state?: string;
  detail?: string;
  proof_path?: string;
}

export interface MaintenanceTask {
  id: string;
  account_id: string;
  avatar_id: string;
  device_id: string | null;
  platform: SocialPlatform | null;
  kind: MaintenanceTaskKind;
  status: MaintenanceTaskStatus;
  priority: number;
  scheduled_for: string;
  params: Record<string, unknown>;
  attempt: number;
  created_by: MaintenanceTaskCreator;
  attention_item_id: string | null;
  worker_id: string | null;
  claimed_at: string | null;
  lease_until: string | null;
  started_at: string | null;
  finished_at: string | null;
  outcome: string | null;
  error_category: string | null;
  error_message: string | null;
  steps: MaintenanceStep[];
  result: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Maturation profile of an avatar (`avatars.maintenance_profile`). */
export const MAINTENANCE_PROFILES = ["new", "mature"] as const;
export type MaintenanceProfile = (typeof MAINTENANCE_PROFILES)[number];

/** `runtime_settings['maintenance.budgets']` — one entry per profile. */
export interface MaintenanceBudget {
  sessions_per_day: number;
  /** [min, max] minutes of one passive session. */
  session_minutes: [number, number];
  likes_per_day: number;
  follows_per_day: number;
}
export type MaintenanceBudgets = Record<MaintenanceProfile, MaintenanceBudget>;

export interface ArmyBrief {
  army_id: string;
  objective: string;
  cluster_keywords: string[];
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A contradiction between the persona and an objective, shown, never hidden. */
export interface BriefContradiction {
  between: string;
  detail: string;
}

export interface AvatarBrief {
  avatar_id: string;
  effective_brief: string;
  contradictions: BriefContradiction[];
  sources: Record<string, unknown>;
  compiled_at: string | null;
  compiled_by: string | null;
  created_at: string;
  updated_at: string;
}
