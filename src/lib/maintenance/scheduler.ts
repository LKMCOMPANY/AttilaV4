import type { MaintenanceBudget, MaintenanceProfile, MaintenanceTaskKind } from "@/types";
import { dayNumberSince, localDateString, localParts, safeTimezone, zonedInstant } from "./local-time";

/**
 * The planner — pure. Given what we know of an avatar (profile, day zero,
 * budget, what already happened today) it says which maintenance tasks the
 * day still needs and when, in the persona's local time, with jitter so no
 * two avatars keep the same clock.
 *
 * Doctrine (Attila_Tutoriel_Avatar_Device.pdf, phase 0-A measurements):
 *   - a NEW account matures: one short passive session a day for three days,
 *     then one or two, then the mature cadence from day 11 — likes and follows
 *     only once mature;
 *   - a MATURE account keeps its budget (sessions per day, minutes);
 *   - an account that paused a week or more comes back on one session, not the
 *     full cadence (the ramp-up);
 *   - sessions live inside the active hours and never bunch up;
 *   - the probe (is the account still logged in? what does the screen say?)
 *     precedes the first session of the day; app and coherence checks are
 *     weekly and ride the same slot.
 *
 * The runner decides what CAN run (mode, budgets, slots); the planner only
 * decides what SHOULD.
 */

export interface ActiveHours {
  /** First local hour a session may start (inclusive). */
  start: number;
  /** Local hour after which no session starts (exclusive). */
  end: number;
}

export interface PlannerInput {
  now: Date;
  timezone: string | null;
  profile: MaintenanceProfile;
  /** `YYYY-MM-DD`; null = treat as mature. */
  dayZero: string | null;
  budget: MaintenanceBudget;
  activeHours: ActiveHours;
  /** Sessions already scheduled, running or done today (local day). */
  sessionsToday: number;
  /** Whether a probe / warmup is already scheduled or done today. */
  probedToday: boolean;
  lastSessionAt: Date | null;
  lastProbeAt: Date | null;
  lastAppCheckAt: Date | null;
  lastCoherenceAt: Date | null;
  probeEveryHours: number;
  appCheckEveryDays: number;
  /** Deterministic jitter source for tests; defaults to Math.random. */
  random?: () => number;
}

export interface PlannedTask {
  kind: MaintenanceTaskKind;
  scheduledFor: Date;
  priority: number;
  params: Record<string, unknown>;
}

export const PRIORITY = {
  warmup: 130,
  probe: 120,
  coherence: 95,
  app_check: 90,
  social_session: 80,
} as const;

/** Days without a session after which the cadence restarts at one. */
export const PAUSE_DAYS_FOR_RAMP = 7;
/** Minimum gap between two sessions of the same avatar. */
export const MIN_SESSION_GAP_MIN = 150;
/** A session planned for a slot already past still runs if it is this fresh. */
const PAST_SLOT_GRACE_MIN = 45;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** 1 on day zero; null when the avatar has no day zero (mature by default). */
export function maturityDay(input: Pick<PlannerInput, "dayZero" | "now" | "timezone">): number | null {
  if (!input.dayZero) return null;
  return dayNumberSince(input.dayZero, input.now, safeTimezone(input.timezone));
}

/**
 * How many sessions the day should hold: the maturation curve for a new
 * account, the budget for a mature one, one after a pause.
 */
export function sessionsForDay(input: PlannerInput): number {
  const day = maturityDay(input);
  const paused =
    input.lastSessionAt !== null && input.now.getTime() - input.lastSessionAt.getTime() >= PAUSE_DAYS_FOR_RAMP * DAY_MS;
  if (paused) return Math.min(1, input.budget.sessions_per_day);
  if (input.profile === "new" && day !== null) {
    if (day <= 3) return Math.min(1, input.budget.sessions_per_day || 1);
    if (day <= 10) return Math.min(day % 2 === 0 ? 2 : 1, Math.max(1, input.budget.sessions_per_day));
  }
  return Math.max(0, input.budget.sessions_per_day);
}

/** Likes and follows are for mature accounts only (day 11+ for a new one). */
export function engagementAllowed(input: PlannerInput): boolean {
  const day = maturityDay(input);
  if (input.profile === "new" && day !== null && day <= 10) return false;
  return input.budget.likes_per_day > 0 || input.budget.follows_per_day > 0;
}

function due(last: Date | null, everyMs: number, now: Date): boolean {
  return last === null || now.getTime() - last.getTime() >= everyMs;
}

/**
 * A daily probe is "one per local day", not "one per 24 h": a probe at 10:00
 * yesterday must not push today's past the first session. Cadences longer than
 * a day fall back to the plain interval.
 */
function probeDue(last: Date | null, everyHours: number, now: Date, tz: string): boolean {
  if (last === null) return true;
  if (everyHours <= 24) return localDateString(last, tz) !== localDateString(now, tz);
  return due(last, everyHours * HOUR_MS, now);
}

/**
 * Plan the rest of today for one avatar. Returns nothing outside the active
 * hours or when the day is already full; never plans the past.
 */
export function planDay(input: PlannerInput): PlannedTask[] {
  const rnd = input.random ?? Math.random;
  const tz = safeTimezone(input.timezone);
  const now = input.now;
  const local = localParts(now, tz);
  const tasks: PlannedTask[] = [];

  // Session slots: the active window sliced evenly, one jittered time per
  // slice, only the slices still ahead of us (or just behind, within grace).
  const wanted = Math.max(0, sessionsForDay(input) - input.sessionsToday);
  const total = Math.max(0, sessionsForDay(input));
  const minutes = () => {
    const [lo, hi] = input.budget.session_minutes;
    return Math.round(lo + rnd() * Math.max(0, hi - lo));
  };
  const slots: Date[] = [];
  if (wanted > 0 && total > 0) {
    const windowStart = zonedInstant(tz, { ...local, hour: input.activeHours.start, minute: 0 });
    const windowEnd = zonedInstant(tz, { ...local, hour: input.activeHours.end, minute: 0 });
    const slice = (windowEnd.getTime() - windowStart.getTime()) / total;
    for (let i = 0; i < total && slots.length < wanted; i++) {
      // Skip the slices already consumed by today's sessions, keep the tail.
      if (i < input.sessionsToday) continue;
      const at = windowStart.getTime() + slice * i + rnd() * slice * 0.8 + slice * 0.1;
      const candidate = new Date(Math.round(at / 60_000) * 60_000);
      if (candidate.getTime() < now.getTime() - PAST_SLOT_GRACE_MIN * 60_000) continue;
      const startAt = candidate.getTime() < now.getTime() ? new Date(now.getTime() + (5 + rnd() * 20) * 60_000) : candidate;
      if (startAt.getTime() >= windowEnd.getTime()) continue;
      const previous = slots[slots.length - 1];
      if (previous && startAt.getTime() - previous.getTime() < MIN_SESSION_GAP_MIN * 60_000) continue;
      slots.push(startAt);
    }
  }
  for (const at of slots) {
    tasks.push({
      kind: "social_session",
      scheduledFor: at,
      priority: PRIORITY.social_session,
      params: { minutes: minutes(), allow_engagement: engagementAllowed(input) },
    });
  }

  // The daily probe (or the warmup on a new account's first day) goes before
  // the first session; with no session left today it runs soon, inside hours.
  const inHours = local.hour >= input.activeHours.start && local.hour < input.activeHours.end;
  const anchor = slots[0] ?? (inHours ? new Date(now.getTime() + (5 + rnd() * 25) * 60_000) : null);
  const day = maturityDay(input);
  if (!input.probedToday && anchor && probeDue(input.lastProbeAt, input.probeEveryHours, now, tz)) {
    const before = new Date(anchor.getTime() - (10 + rnd() * 20) * 60_000);
    const at = before.getTime() < now.getTime() ? now : before;
    const firstDay = input.profile === "new" && day === 1;
    tasks.push({
      kind: firstDay ? "warmup" : "probe",
      scheduledFor: at,
      priority: firstDay ? PRIORITY.warmup : PRIORITY.probe,
      params: {},
    });
    if (due(input.lastAppCheckAt, input.appCheckEveryDays * DAY_MS, now)) {
      tasks.push({ kind: "app_check", scheduledFor: at, priority: PRIORITY.app_check, params: {} });
    }
    if (due(input.lastCoherenceAt, input.appCheckEveryDays * DAY_MS, now)) {
      tasks.push({ kind: "coherence", scheduledFor: at, priority: PRIORITY.coherence, params: {} });
    }
  }

  return tasks.sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime() || b.priority - a.priority);
}
