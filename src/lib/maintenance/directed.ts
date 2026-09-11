import { z } from "zod";
import type { SocialPlatform } from "@/types";
import { localParts, safeTimezone, zonedInstant } from "./local-time";
import type { ActiveHours } from "./scheduler";

/**
 * A directed action: a human's order — like this post, follow this creator,
 * comment this — carried by one avatar or fanned out over an army. Pure
 * vocabulary and planning here; the gestures live in the recipe, the request
 * in the operator core.
 *
 * Two rules the planning never bends (MAINTENANCE-AGENT.md, the anti-detection
 * protocol): an army never acts at once — the orders spread over hours, and
 * two avatars of one box never share a minute; and nothing acts outside the
 * persona's active hours, in the device's own time zone.
 */

export const DIRECTED_ACTIONS = ["like", "follow", "comment"] as const;
export type DirectedActionKind = (typeof DIRECTED_ACTIONS)[number];

/** `maintenance_tasks.params` of a `directed_action` task. */
export const directedParamsSchema = z
  .object({
    action: z.enum(DIRECTED_ACTIONS),
    target_url: z.string().url(),
    text: z.string().min(1).max(500).optional(),
    /** Groups the tasks of one order (an army fan-out shares it). */
    request_id: z.string().uuid(),
    requested_by: z.string().uuid(),
  })
  .refine((p) => p.action !== "comment" || Boolean(p.text?.trim()), { message: "a comment needs `text`", path: ["text"] });

export type DirectedParams = z.infer<typeof directedParamsSchema>;

/** What a target URL names, as the recipe must find it on screen. */
export interface ParsedTarget {
  platform: SocialPlatform;
  /** The account the URL belongs to, without `@`; null on short links. */
  handle: string | null;
  kind: "post" | "profile" | "unknown";
  /** The profile URL of the handle — what a follow opens. */
  profileUrl: string | null;
}

const TIKTOK_HOSTS = ["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"];
const X_HOSTS = ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"];

/** Which platform a URL belongs to, and what it points at. */
export function parseTarget(url: string): ParsedTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (TIKTOK_HOSTS.includes(host)) {
    const handle = segments[0]?.startsWith("@") ? segments[0].slice(1) : null;
    if (!handle) return { platform: "tiktok", handle: null, kind: "unknown", profileUrl: null };
    const kind = segments[1] === "video" && segments[2] ? "post" : segments.length === 1 ? "profile" : "unknown";
    return { platform: "tiktok", handle, kind, profileUrl: `https://www.tiktok.com/@${handle}` };
  }
  if (X_HOSTS.includes(host)) {
    const reserved = ["i", "home", "explore", "search", "settings", "intent", "hashtag"];
    const handle = segments[0] && !reserved.includes(segments[0]) ? segments[0] : null;
    if (!handle) return { platform: "twitter", handle: null, kind: "unknown", profileUrl: null };
    const kind = segments[1] === "status" && segments[2] ? "post" : segments.length === 1 ? "profile" : "unknown";
    return { platform: "twitter", handle, kind, profileUrl: `https://x.com/${handle}` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fan-out schedule
// ---------------------------------------------------------------------------

export interface ScheduleCandidate {
  avatarId: string;
  boxId: string;
  timezone: string | null;
}

export interface ScheduleOptions {
  /** Hours the orders spread over; one avatar is immediate whatever this says. */
  spreadHours: number;
  activeHours: ActiveHours;
  now: Date;
  random?: () => number;
}

export interface ScheduledOrder {
  avatarId: string;
  scheduledFor: Date;
  /** Pushed past the spread because of the active hours or a box collision. */
  adjusted: boolean;
}

/** Two avatars of one box never act within this gap. */
export const BOX_GAP_MS = 90_000;
/** Default and ceiling of the spread, in hours. */
export const DEFAULT_SPREAD_HOURS = 2;
export const MAX_SPREAD_HOURS = 12;
/** When an order lands outside the active hours it waits for the window, plus this jitter. */
const WINDOW_OPEN_JITTER_MIN = 45;

/**
 * Where each order lands in time. One avatar: now. Several: uniformly over
 * the spread, then two corrections in order — into the device's active hours
 * (the next window when the day's has closed), and at least `BOX_GAP_MS`
 * apart from the previous order on the same box.
 */
export function planDirectedSchedule(candidates: readonly ScheduleCandidate[], options: ScheduleOptions): ScheduledOrder[] {
  const rnd = options.random ?? Math.random;
  const spreadMs = Math.min(MAX_SPREAD_HOURS, Math.max(0, options.spreadHours)) * 3_600_000;
  const now = options.now.getTime();

  const proposals = candidates.map((candidate) => ({
    candidate,
    at: candidates.length === 1 ? now : now + rnd() * spreadMs,
  }));
  proposals.sort((a, b) => a.at - b.at);

  const lastPerBox = new Map<string, number>();
  return proposals.map(({ candidate, at }) => {
    let scheduled = at;
    let adjusted = false;
    const inHours = intoActiveHours(new Date(scheduled), candidate.timezone, options.activeHours, rnd);
    if (inHours.getTime() !== scheduled) {
      scheduled = inHours.getTime();
      adjusted = true;
    }
    const previous = lastPerBox.get(candidate.boxId);
    if (previous !== undefined && scheduled < previous + BOX_GAP_MS) {
      scheduled = previous + BOX_GAP_MS + Math.round(rnd() * 30_000);
      adjusted = true;
    }
    lastPerBox.set(candidate.boxId, scheduled);
    return { avatarId: candidate.avatarId, scheduledFor: new Date(scheduled), adjusted };
  });
}

/** The instant itself when inside the window; the next window's opening otherwise. */
export function intoActiveHours(at: Date, timezone: string | null, hours: ActiveHours, rnd: () => number = Math.random): Date {
  const tz = safeTimezone(timezone);
  const local = localParts(at, tz);
  if (local.hour >= hours.start && local.hour < hours.end) return at;
  const opening = { ...local, hour: hours.start, minute: 0 };
  let next = zonedInstant(tz, opening);
  if (next.getTime() <= at.getTime()) {
    // Today's window is over: tomorrow's opening.
    const tomorrow = new Date(at.getTime() + 24 * 3_600_000);
    next = zonedInstant(tz, { ...localParts(tomorrow, tz), hour: hours.start, minute: 0 });
  }
  return new Date(next.getTime() + Math.round(rnd() * WINDOW_OPEN_JITTER_MIN) * 60_000);
}
