/**
 * Structured automation error categories. Used to signal *why* a job failed
 * so operators can decide what to do next (re-login an avatar, ack a
 * captcha, retry later, file a bug…) without having to read raw logs.
 *
 * Categories are encoded in the persisted `error_message` as a `[category]`
 * prefix (`[account_logged_out] X session expired …`) — zero DB migration,
 * frontend `parseJobError()` strips and surfaces the category as a badge.
 */

export type JobErrorCategory =
  // Infrastructure — typically transient, safe to retry later
  | "container_not_ready"     // VMOS reports container not running
  | "infrastructure"          // network / box outage / 5xx
  // Setup — fixable on the device by an admin / one-time provisioning
  | "device_setup_required"   // ADBKeyboard missing, app missing, etc.
  | "consent_required"        // first-launch GDPR / ads dialog
  // Account-level — operator must intervene on the avatar's session
  | "account_logged_out"      // session expired / not signed in
  | "account_blocked"         // suspended, banned, restricted
  | "account_captcha"         // captcha / suspicious activity challenge
  | "rate_limited"            // platform throttling
  // Content — the target post itself is unreachable, skip definitively
  | "content_unavailable"     // deleted, private, 404, geo-blocked
  // Catch-all
  | "ui_unexpected"           // we landed in an unknown UI state
  | "unknown";

/**
 * High-level severity for the operator dashboard. Drives the visual badge.
 *   - `action_required` : the avatar/device cannot work until a human acts
 *   - `transient`       : safe to leave the campaign running, will retry
 *   - `terminal`        : this specific post will never succeed, skip
 *   - `bug`             : unexpected, needs investigation
 */
export type JobErrorSeverity = "action_required" | "transient" | "terminal" | "bug";

const SEVERITY_BY_CATEGORY: Record<JobErrorCategory, JobErrorSeverity> = {
  container_not_ready: "transient",
  infrastructure: "transient",
  device_setup_required: "action_required",
  consent_required: "action_required",
  account_logged_out: "action_required",
  account_blocked: "action_required",
  account_captcha: "action_required",
  rate_limited: "transient",
  content_unavailable: "terminal",
  ui_unexpected: "bug",
  unknown: "bug",
};

export function severityOf(category: JobErrorCategory): JobErrorSeverity {
  return SEVERITY_BY_CATEGORY[category];
}

/**
 * Thrown by automation modules to flag a known failure mode. The pipeline
 * executor catches it and serialises the category into the persisted error
 * message so the dashboard can display the right badge.
 */
export class JobError extends Error {
  constructor(
    public readonly category: JobErrorCategory,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "JobError";
  }
}

// ---------------------------------------------------------------------------
// Wire encoding — `[category] message`
// ---------------------------------------------------------------------------

// Match `[category] message`. The body uses `[\s\S]` instead of `.` so we
// don't need the `s` (dotAll) flag — keeps the project compatible with the
// ES2017 compile target.
const PREFIX_RE = /^\[([a-z_]+)\]\s*([\s\S]*)$/;

/**
 * Render an error to the form persisted in `campaign_jobs.error_message`.
 * Recognises a few known error classes (without importing them, to avoid
 * a circular dep with `box-api`) by their `name` field. Plain `Error`
 * falls back to category `unknown`.
 */
export function encodeJobError(err: unknown): string {
  if (err instanceof JobError) {
    return `[${err.category}] ${err.message}`;
  }
  if (err instanceof Error) {
    if (err.name === "ContainerNotReadyError") {
      return `[container_not_ready] ${err.message}`;
    }
    return `[unknown] ${err.message}`;
  }
  return `[unknown] ${String(err)}`;
}

export interface ParsedJobError {
  category: JobErrorCategory;
  severity: JobErrorSeverity;
  message: string;
  /** True when a known `[category]` prefix was found. */
  structured: boolean;
}

/**
 * Inverse of `encodeJobError`. Frontend-safe: never throws and tolerates
 * legacy raw strings (jobs that pre-date the encoding scheme).
 */
export function parseJobError(raw: string | null | undefined): ParsedJobError | null {
  if (!raw) return null;
  const match = PREFIX_RE.exec(raw);
  if (match && isKnownCategory(match[1])) {
    const category = match[1] as JobErrorCategory;
    return {
      category,
      severity: severityOf(category),
      message: match[2],
      structured: true,
    };
  }
  return {
    category: "unknown",
    severity: severityOf("unknown"),
    message: raw,
    structured: false,
  };
}

function isKnownCategory(value: string): value is JobErrorCategory {
  return value in SEVERITY_BY_CATEGORY;
}
