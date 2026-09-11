import type { MaintenanceMode, MaintenanceTaskKind } from "@/types";

/**
 * The deployment ladder of the maintainer, as a rule the runner enforces —
 * not a convention the operator has to remember (MAINTENANCE-AGENT.md §5.1):
 *
 *   observe     — read only. Probes and checks run; sessions and re-logins are
 *                 planned so the queue shows what WOULD run, then skipped.
 *   supervised  — the passive session runs (open, dwell, scroll, clear a
 *                 dialog the safe way) under a human's eye. Nothing is done TO
 *                 the account: no like, no follow, no re-login.
 *   autonomous  — everything the recipes know: engagement inside the session
 *                 within the day's budget, the deterministic re-login.
 *
 * The planner ignores the mode on purpose; the mode is read when a task is
 * claimed, so a switch takes effect within one beat and a running task ends
 * under the rules it started with.
 */

const READ_ONLY_KINDS: readonly MaintenanceTaskKind[] = ["probe", "app_check", "coherence", "dismiss_dialogs", "warmup"];
const PASSIVE_KINDS: readonly MaintenanceTaskKind[] = [...READ_ONLY_KINDS, "social_session"];
const ALL_KINDS: readonly MaintenanceTaskKind[] = [...PASSIVE_KINDS, "relogin"];

export interface ModeGrant {
  /** Task kinds the runner executes; any other kind is skipped as `<mode>_mode`. */
  kinds: readonly MaintenanceTaskKind[];
  /** Whether a session may like or follow (still subject to the planner's `allow_engagement` and the budget). */
  engagement: boolean;
}

export const MODE_GRANTS: Record<MaintenanceMode, ModeGrant> = {
  observe: { kinds: READ_ONLY_KINDS, engagement: false },
  supervised: { kinds: PASSIVE_KINDS, engagement: false },
  autonomous: { kinds: ALL_KINDS, engagement: true },
};

export function modeAllows(mode: MaintenanceMode, kind: MaintenanceTaskKind): boolean {
  return MODE_GRANTS[mode].kinds.includes(kind);
}

export function engagementAllowedIn(mode: MaintenanceMode): boolean {
  return MODE_GRANTS[mode].engagement;
}

/** The outcome written on a task the mode withheld, e.g. `observe_mode`. */
export function withheldOutcome(mode: MaintenanceMode): string {
  return `${mode}_mode`;
}
