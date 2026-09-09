import { describe, expect, it } from "vitest";
import { dayNumberSince, localParts, offsetMinutes, zonedInstant } from "./local-time";
import {
  MIN_SESSION_GAP_MIN,
  engagementAllowed,
  maturityDay,
  planDay,
  sessionsForDay,
  type PlannerInput,
} from "./scheduler";

/** A deterministic "random" that walks a fixed sequence. */
function seeded(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

const MATURE = { sessions_per_day: 2, session_minutes: [5, 12] as [number, number], likes_per_day: 6, follows_per_day: 2 };
const NEW = { sessions_per_day: 1, session_minutes: [3, 6] as [number, number], likes_per_day: 0, follows_per_day: 0 };

function input(over: Partial<PlannerInput> = {}): PlannerInput {
  return {
    // 09:00 Paris on a Wednesday.
    now: new Date("2026-09-09T07:00:00.000Z"),
    timezone: "Europe/Paris",
    profile: "mature",
    dayZero: null,
    budget: MATURE,
    activeHours: { start: 8, end: 23 },
    sessionsToday: 0,
    probedToday: false,
    lastSessionAt: new Date("2026-09-08T15:00:00.000Z"),
    lastProbeAt: new Date("2026-09-08T08:00:00.000Z"),
    lastAppCheckAt: new Date("2026-09-08T08:00:00.000Z"),
    lastCoherenceAt: new Date("2026-09-08T08:00:00.000Z"),
    probeEveryHours: 24,
    appCheckEveryDays: 7,
    random: seeded([0.5]),
    ...over,
  };
}

describe("local time", () => {
  it("reads wall-clock parts and offsets in the persona's zone", () => {
    const at = new Date("2026-09-09T07:00:00.000Z");
    expect(localParts(at, "Europe/Paris")).toEqual({ year: 2026, month: 9, day: 9, hour: 9, minute: 0 });
    expect(offsetMinutes(at, "Europe/Paris")).toBe(120);
    expect(offsetMinutes(at, "America/New_York")).toBe(-240);
    expect(zonedInstant("Europe/Paris", { year: 2026, month: 9, day: 9, hour: 8, minute: 0 }).toISOString()).toBe(
      "2026-09-09T06:00:00.000Z",
    );
  });

  it("falls back to UTC on an unknown zone instead of throwing", () => {
    expect(localParts(new Date("2026-09-09T07:00:00.000Z"), "Mars/Olympus").hour).toBe(7);
  });

  it("counts maturity days from day zero, day zero being day 1", () => {
    expect(dayNumberSince("2026-09-09", new Date("2026-09-09T07:00:00.000Z"), "Europe/Paris")).toBe(1);
    expect(dayNumberSince("2026-09-01", new Date("2026-09-09T07:00:00.000Z"), "Europe/Paris")).toBe(9);
    expect(dayNumberSince("garbage", new Date(), "Europe/Paris")).toBeNull();
  });
});

describe("sessions per day", () => {
  it("a mature account keeps its budget", () => {
    expect(sessionsForDay(input())).toBe(2);
  });

  it("a new account matures: one, then one or two, then the budget", () => {
    const fresh = (day: number) =>
      input({ profile: "new", budget: { ...NEW, sessions_per_day: 2 }, dayZero: dayZeroFor(day) });
    expect(sessionsForDay(fresh(1))).toBe(1);
    expect(sessionsForDay(fresh(3))).toBe(1);
    expect(sessionsForDay(fresh(4))).toBe(2);
    expect(sessionsForDay(fresh(5))).toBe(1);
    expect(sessionsForDay(fresh(11))).toBe(2);
  });

  it("an account back from a week's pause restarts on one session", () => {
    expect(sessionsForDay(input({ lastSessionAt: new Date("2026-08-30T07:00:00.000Z") }))).toBe(1);
  });

  it("likes and follows wait for maturity", () => {
    expect(engagementAllowed(input())).toBe(true);
    expect(engagementAllowed(input({ profile: "new", dayZero: dayZeroFor(5), budget: MATURE }))).toBe(false);
    expect(engagementAllowed(input({ profile: "new", dayZero: dayZeroFor(12), budget: MATURE }))).toBe(true);
    expect(engagementAllowed(input({ budget: NEW }))).toBe(false);
  });
});

describe("plan of the day", () => {
  it("spreads the sessions inside the active hours, probe first, weekly checks alongside", () => {
    const plan = planDay(input({ lastAppCheckAt: new Date("2026-08-30T08:00:00.000Z"), lastCoherenceAt: null }));
    const kinds = plan.map((t) => t.kind);
    expect(kinds.filter((k) => k === "social_session")).toHaveLength(2);
    expect(kinds).toContain("probe");
    expect(kinds).toContain("app_check");
    expect(kinds).toContain("coherence");
    expect(kinds).not.toContain("warmup");

    const sessions = plan.filter((t) => t.kind === "social_session");
    for (const session of sessions) {
      const hour = localParts(session.scheduledFor, "Europe/Paris").hour;
      expect(hour).toBeGreaterThanOrEqual(8);
      expect(hour).toBeLessThan(23);
      expect(session.params.minutes).toBeGreaterThanOrEqual(5);
      expect(session.params.minutes).toBeLessThanOrEqual(12);
      expect(session.params.allow_engagement).toBe(true);
    }
    const gap = (sessions[1].scheduledFor.getTime() - sessions[0].scheduledFor.getTime()) / 60_000;
    expect(gap).toBeGreaterThanOrEqual(MIN_SESSION_GAP_MIN);

    const probe = plan.find((t) => t.kind === "probe")!;
    expect(probe.scheduledFor.getTime()).toBeLessThanOrEqual(sessions[0].scheduledFor.getTime());
    expect(probe.scheduledFor.getTime()).toBeGreaterThanOrEqual(input().now.getTime());
    // Sorted by time; nothing in the past.
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].scheduledFor.getTime()).toBeGreaterThanOrEqual(plan[i - 1].scheduledFor.getTime());
    }
  });

  it("plans nothing more once the day is full and probed", () => {
    expect(planDay(input({ sessionsToday: 2, probedToday: true }))).toEqual([]);
  });

  it("keeps only the slots still ahead when planning late in the day", () => {
    // 21:30 Paris: one slice left at most, and it must end before 23:00.
    const late = input({ now: new Date("2026-09-09T19:30:00.000Z"), random: seeded([0.9]) });
    const plan = planDay(late);
    for (const task of plan) {
      expect(task.scheduledFor.getTime()).toBeGreaterThanOrEqual(late.now.getTime());
      expect(localParts(task.scheduledFor, "Europe/Paris").hour).toBeLessThan(23);
    }
  });

  it("plans nothing outside the active hours", () => {
    // 02:00 Paris: sessions land later today (inside hours), the probe rides them.
    const night = planDay(input({ now: new Date("2026-09-09T00:00:00.000Z") }));
    for (const task of night) {
      expect(localParts(task.scheduledFor, "Europe/Paris").hour).toBeGreaterThanOrEqual(8);
    }
    // 23:30 Paris with the day full: nothing at all.
    expect(planDay(input({ now: new Date("2026-09-09T21:30:00.000Z"), sessionsToday: 2, probedToday: true }))).toEqual([]);
  });

  it("a new account's first day opens with a warmup, no engagement", () => {
    const plan = planDay(input({ profile: "new", budget: NEW, dayZero: dayZeroFor(1), lastProbeAt: null, lastSessionAt: null }));
    expect(plan.map((t) => t.kind)).toContain("warmup");
    expect(plan.map((t) => t.kind)).not.toContain("probe");
    const session = plan.find((t) => t.kind === "social_session")!;
    expect(session.params.allow_engagement).toBe(false);
    expect(maturityDay(input({ dayZero: dayZeroFor(1) }))).toBe(1);
  });

  it("skips the probe when one already happened today", () => {
    const plan = planDay(input({ probedToday: true }));
    expect(plan.map((t) => t.kind)).not.toContain("probe");
    expect(plan.filter((t) => t.kind === "social_session")).toHaveLength(2);
  });
});

/** Day zero such that "now" (9 Sept 2026, Paris) is maturity day `day`. */
function dayZeroFor(day: number): string {
  const zero = new Date(Date.UTC(2026, 8, 9) - (day - 1) * 86_400_000);
  return zero.toISOString().slice(0, 10);
}

describe("re-login planning", () => {
  it("a logged-out account gets one re-login inside the hours and no session", () => {
    const plan = planDay(input({ onDeviceStatus: "logged_out", lastReloginAt: null, reloginCooldownHours: 24 }));
    expect(plan.map((t) => t.kind)).toEqual(["relogin"]);
    expect(plan[0].scheduledFor.getTime()).toBeGreaterThan(input().now.getTime());
  });

  it("respects the cooldown and the active hours", () => {
    const recent = new Date("2026-09-09T02:00:00.000Z");
    expect(planDay(input({ onDeviceStatus: "logged_out", lastReloginAt: recent, reloginCooldownHours: 24 }))).toEqual([]);
    const night = input({ now: new Date("2026-09-09T00:00:00.000Z"), onDeviceStatus: "logged_out", lastReloginAt: null });
    expect(planDay(night)).toEqual([]);
  });
});
