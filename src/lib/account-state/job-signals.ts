import { parseJobError } from "@/lib/automation/errors";
import type {
  AvatarHealthSignals,
  DeviceAccountIssue,
} from "@/lib/constants/account-health";
import type { SocialPlatform } from "@/types";

// ---------------------------------------------------------------------------
// Job-history → per-(avatar, platform) health signals.
//
// The two inputs TikHub's profile lookup can't provide, both read from an
// account's recent jobs:
//   - deviceIssue: the most recent attempt hit a login / block / captcha screen
//     ON the device (certain — we saw it).
//   - shadowBan:   posts were reported sent on-device but NONE were confirmed
//     live by TikHub in the window (the "A+B ok, C fails" case).
//   - confirmed:   at least one post was independently confirmed live — proof
//     the account works, regardless of what the profile lookup says.
//
// Extracted here so the SAME derivation feeds both the operator UI
// (`getAvatarHealthSignals`) and the account-health worker's reconcile pass —
// one implementation, no drift.
// ---------------------------------------------------------------------------

export const HEALTH_SIGNAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Automation error category → the on-device account issue it represents. */
export const DEVICE_ISSUE_BY_CATEGORY: Record<string, DeviceAccountIssue> = {
  account_logged_out: "logged_out",
  account_blocked: "blocked",
  account_captcha: "captcha",
};

export interface JobSignalRow {
  avatar_id: string;
  platform: SocialPlatform;
  status: string;
  verification: string | null;
  error_message: string | null;
}

/**
 * Reduce recent jobs (MUST be ordered newest-first) into per-avatar signals.
 * The newest job per (avatar, platform) decides the current on-device state;
 * done jobs are tallied for the confirmed / shadow-ban verdict.
 */
export function computeJobSignals(
  rows: JobSignalRow[],
): Record<string, AvatarHealthSignals> {
  const result: Record<string, AvatarHealthSignals> = {};
  const latestSeen = new Set<string>();
  const doneCounts = new Map<string, { confirmed: number; unconfirmed: number }>();

  for (const job of rows) {
    const key = `${job.avatar_id}:${job.platform}`;

    if (!latestSeen.has(key)) {
      latestSeen.add(key);
      if (job.status === "failed") {
        const category = parseJobError(job.error_message)?.category;
        const issue = category ? DEVICE_ISSUE_BY_CATEGORY[category] : undefined;
        if (issue) setSignal(result, job.avatar_id, job.platform, { deviceIssue: issue });
      }
    }

    if (job.status === "done") {
      const counts = doneCounts.get(key) ?? { confirmed: 0, unconfirmed: 0 };
      if (job.verification === "confirmed") counts.confirmed++;
      else if (job.verification === "unconfirmed") counts.unconfirmed++;
      doneCounts.set(key, counts);
    }
  }

  for (const [key, counts] of doneCounts) {
    const [avatarId, platform] = key.split(":") as [string, SocialPlatform];
    // A single confirmed post proves the account works (ground truth over the
    // profile lookup — a `notfound` then means a wrong stored @handle).
    if (counts.confirmed > 0) {
      setSignal(result, avatarId, platform, { confirmed: true });
    } else if (counts.unconfirmed > 0) {
      // Posts went out but NONE were confirmed live in the window → shadow-ban.
      setSignal(result, avatarId, platform, { shadowBan: true });
    }
  }

  return result;
}

function setSignal(
  result: Record<string, AvatarHealthSignals>,
  avatarId: string,
  platform: SocialPlatform,
  patch: { deviceIssue?: DeviceAccountIssue; shadowBan?: boolean; confirmed?: boolean },
): void {
  const forAvatar = result[avatarId] ?? {};
  forAvatar[platform] = { ...forAvatar[platform], ...patch };
  result[avatarId] = forAvatar;
}
