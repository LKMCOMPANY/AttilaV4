import type {
  AvatarPlatformState,
  MaintenanceMode,
  MaintenanceProfile,
  MaintenanceTaskKind,
  MaintenanceTaskStatus,
  OnDeviceStatus,
} from "@/types";

// ---------------------------------------------------------------------------
// Maintenance layer — presentation vocabulary shared by both clients
// (`MaintenancePresentation.swift` mirrors this file; both are pinned to
// `__fixtures__/maintenance-vocabulary.json`). Framework-free.
// ---------------------------------------------------------------------------

/** Semantic tone → colour: critical = danger, watch = warning, ok = success, info = info, muted = muted. */
export type MaintenanceTone = "critical" | "watch" | "ok" | "info" | "muted";

export interface MaintenanceMeta {
  label: string;
  tone: MaintenanceTone;
}

export const ON_DEVICE_STATUS_META: Record<OnDeviceStatus, MaintenanceMeta> = {
  unknown: { label: "Not probed", tone: "muted" },
  logged_in: { label: "Logged in", tone: "ok" },
  logged_out: { label: "Logged out", tone: "critical" },
  challenge: { label: "Challenge", tone: "critical" },
  suspended: { label: "Suspended", tone: "critical" },
  app_missing: { label: "App missing", tone: "watch" },
  app_outdated: { label: "App out of date", tone: "watch" },
  unreadable: { label: "Unreadable", tone: "watch" },
};

export const TASK_KIND_LABEL: Record<MaintenanceTaskKind, string> = {
  probe: "Probe",
  warmup: "Warm-up",
  dismiss_dialogs: "Clear dialogs",
  coherence: "Coherence check",
  app_check: "App check",
  social_session: "Session",
  relogin: "Re-login",
  directed_action: "Order",
};

export const TASK_STATUS_META: Record<MaintenanceTaskStatus, MaintenanceMeta> = {
  scheduled: { label: "Scheduled", tone: "muted" },
  running: { label: "Running", tone: "info" },
  done: { label: "Done", tone: "ok" },
  failed: { label: "Failed", tone: "critical" },
  skipped: { label: "Skipped", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export const PROFILE_LABEL: Record<MaintenanceProfile, string> = {
  new: "New account",
  mature: "Mature account",
};

export const MODE_LABEL: Record<MaintenanceMode, string> = {
  observe: "Observe",
  supervised: "Supervised",
  autonomous: "Autonomous",
};

/**
 * How long a probe verdict is worth showing. A device probed a week ago may
 * have been fixed since; a badge that cries wolf gets ignored (same doctrine
 * as `actionableBootHealth`).
 */
export const ON_DEVICE_SHELF_LIFE_DAYS = 7;

/**
 * The on-device badge rule, identical in TypeScript and Swift: show the state
 * only when it says something (not `unknown`, not `logged_in`), is dated, and
 * is fresh. Returns the status to show, or null for silence.
 */
export function actionableOnDeviceStatus(
  state: Pick<AvatarPlatformState, "on_device_status" | "probed_at"> | null | undefined,
  now: Date = new Date(),
): OnDeviceStatus | null {
  if (!state || !state.probed_at) return null;
  if (state.on_device_status === "unknown" || state.on_device_status === "logged_in") return null;
  const probedAt = new Date(state.probed_at).getTime();
  if (Number.isNaN(probedAt)) return null;
  if (now.getTime() - probedAt > ON_DEVICE_SHELF_LIFE_DAYS * 86_400_000) return null;
  return state.on_device_status;
}

/** Human wording of the self-audit threshold (see `report.ts`). */
export const TOO_REGULAR_THRESHOLD_LABEL = "start minutes within a few minutes of each other";
