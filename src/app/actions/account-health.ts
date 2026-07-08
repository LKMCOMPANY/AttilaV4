"use server";

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { parseJobError } from "@/lib/automation/errors";
import type {
  AvatarHealthSignals,
  DeviceAccountIssue,
} from "@/lib/constants/account-health";
import type { SocialPlatform } from "@/types";

// ---------------------------------------------------------------------------
// Per-avatar health signals for the operator — the two inputs the TikHub
// profile row can't provide, read from the account's recent jobs:
//   - deviceIssue: the most recent attempt hit a login / block / captcha screen
//     ON the device (certain, we saw it). Cleared as soon as a later attempt
//     succeeds, so a reconnected account stops flagging on its own.
//   - shadowBan: posts were reported sent on-device but NONE were confirmed
//     live by TikHub in the window — the "A+B ok, C fails" case.
// ---------------------------------------------------------------------------

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const DEVICE_ISSUE_BY_CATEGORY: Record<string, DeviceAccountIssue> = {
  account_logged_out: "logged_out",
  account_blocked: "blocked",
  account_captcha: "captcha",
};

interface JobRow {
  avatar_id: string;
  platform: SocialPlatform;
  status: string;
  verification: string;
  error_message: string | null;
}

export async function getAvatarHealthSignals(
  accountId: string,
): Promise<Record<string, AvatarHealthSignals>> {
  const session = await requireSession();
  if (session.profile.role !== "admin" && accountId !== session.profile.account_id) {
    return {};
  }

  const supabase = await createClient();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const { data } = await supabase
    .from("campaign_jobs")
    .select("avatar_id, platform, status, verification, error_message")
    .eq("account_id", accountId)
    .gte("completed_at", since)
    .order("completed_at", { ascending: false });

  if (!data) return {};

  const result: Record<string, AvatarHealthSignals> = {};
  // The newest job per (avatar, platform) decides the current on-device state.
  const latestSeen = new Set<string>();
  const doneCounts = new Map<string, { confirmed: number; unconfirmed: number }>();

  for (const job of data as JobRow[]) {
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
