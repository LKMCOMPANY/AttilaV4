/**
 * Wall-clock arithmetic in a device's timezone, without a date library. The
 * planner thinks in the PERSONA's day (sessions between 8 h and 23 h where the
 * avatar lives), the database stores UTC instants.
 */

export interface LocalParts {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
  hour: number; // 0–23
  minute: number;
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = partFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    partFormatters.set(timezone, formatter);
  }
  return formatter;
}

/** Falls back to UTC on an unknown zone so a bad `devices.timezone` never breaks planning. */
export function safeTimezone(timezone: string | null | undefined): string {
  if (!timezone) return "UTC";
  try {
    formatterFor(timezone);
    return timezone;
  } catch {
    return "UTC";
  }
}

export function localParts(at: Date, timezone: string): LocalParts {
  const parts = formatterFor(safeTimezone(timezone)).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** `YYYY-MM-DD` of `at` in `timezone`. */
export function localDateString(at: Date, timezone: string): string {
  const p = localParts(at, timezone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Minutes the zone is ahead of UTC at `at` (positive east of Greenwich). */
export function offsetMinutes(at: Date, timezone: string): number {
  const p = localParts(at, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const truncated = Math.floor(at.getTime() / 60_000) * 60_000;
  return Math.round((asUtc - truncated) / 60_000);
}

/**
 * The instant of a wall-clock time in `timezone` (two passes absorb a DST
 * change between the guess and the answer).
 */
export function zonedInstant(timezone: string, parts: LocalParts): Date {
  const tz = safeTimezone(timezone);
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let guess = new Date(wall - offsetMinutes(new Date(wall), tz) * 60_000);
  guess = new Date(wall - offsetMinutes(guess, tz) * 60_000);
  return guess;
}

/** Whole local days from `dayZero` (`YYYY-MM-DD`) to `at`, 1 on day zero itself. */
export function dayNumberSince(dayZero: string, at: Date, timezone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayZero);
  if (!match) return null;
  const today = localParts(at, timezone);
  const start = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const now = Date.UTC(today.year, today.month - 1, today.day);
  return Math.floor((now - start) / 86_400_000) + 1;
}
