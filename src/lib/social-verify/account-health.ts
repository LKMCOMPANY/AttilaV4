import { createAdminClient } from "@/lib/supabase/admin";
import {
  isTikHubEnabled,
  getTwitterAccountHealth,
  getTikTokAccountHealth,
  type AccountHealth,
} from "./tikhub";
import type { AccountHealthStatus } from "@/types";

/**
 * Off-device account-health pass (TikHub).
 *
 * For each avatar with an enabled platform + a handle, look up the public
 * profile and record whether the account is `active`, `suspended`, `notfound`,
 * or `unknown` in `avatar_platform_health`. This is the authoritative reason
 * an on-device "done" post can end up `unconfirmed`: a suspended/deleted
 * account still lets the app dismiss the composer, so the reply silently drops.
 *
 * Design mirrors the TikHub verify pass:
 *   - env-gated (no key → no-op),
 *   - best-effort (a probe failure never overwrites a good verdict),
 *   - paced by staleness so a fixed batch per cycle eventually covers the fleet
 *     without hammering the paid API.
 *
 * It is purely informational — it NEVER tags/blocks an avatar or touches the
 * pipeline. A false "suspended" from a scraper must never stop a live account.
 */

// Only platforms with a TikHub profile lookup today.
const HEALTH_PLATFORMS = ["twitter", "tiktok"] as const;
type HealthPlatform = (typeof HEALTH_PLATFORMS)[number];

// Re-probe each account roughly every 6h: account status changes slowly and
// each probe is a paid call.
const STALE_MS = 6 * 60 * 60 * 1000;
// Accounts probed per cycle. With the worker cadence (a few minutes) this
// comfortably covers a few-hundred-avatar fleet within the staleness window.
const BATCH = 8;

export interface HealthPassResult {
  checked: number;
  active: number;
  suspended: number;
  notfound: number;
  skipped: number;
}

interface Candidate {
  avatarId: string;
  accountId: string;
  platform: HealthPlatform;
  handle: string;
  checkedAt: number | null;
}

const CRED_COLUMN: Record<HealthPlatform, "twitter_credentials" | "tiktok_credentials"> = {
  twitter: "twitter_credentials",
  tiktok: "tiktok_credentials",
};
const ENABLED_COLUMN: Record<HealthPlatform, "twitter_enabled" | "tiktok_enabled"> = {
  twitter: "twitter_enabled",
  tiktok: "tiktok_enabled",
};

interface AvatarRow {
  id: string;
  account_id: string;
  twitter_enabled: boolean;
  tiktok_enabled: boolean;
  twitter_credentials: { handle?: string } | null;
  tiktok_credentials: { handle?: string } | null;
}

export async function refreshAccountHealth(): Promise<HealthPassResult> {
  const result: HealthPassResult = { checked: 0, active: 0, suspended: 0, notfound: 0, skipped: 0 };
  if (!isTikHubEnabled()) return result;

  const supabase = createAdminClient();
  const now = Date.now();

  // Only probe accounts actually under automation. Health matters where a
  // campaign runs; probing idle clients wastes paid TikHub calls and surfaces
  // confusing labels on accounts nobody is operating.
  const { data: activeCampaigns } = await supabase
    .from("campaigns")
    .select("account_id")
    .eq("status", "active");

  const automatedAccountIds = [
    ...new Set((activeCampaigns ?? []).map((c) => c.account_id as string)),
  ];
  if (automatedAccountIds.length === 0) return result;

  const { data: avatars } = await supabase
    .from("avatars")
    .select(
      "id, account_id, twitter_enabled, tiktok_enabled, twitter_credentials, tiktok_credentials",
    )
    .eq("status", "active")
    .is("archived_at", null)
    .in("account_id", automatedAccountIds)
    .or("twitter_enabled.eq.true,tiktok_enabled.eq.true");

  if (!avatars || avatars.length === 0) return result;

  const { data: healthRows } = await supabase
    .from("avatar_platform_health")
    .select("avatar_id, platform, checked_at");

  const lastCheckedByKey = new Map<string, number>();
  for (const row of healthRows ?? []) {
    lastCheckedByKey.set(
      `${row.avatar_id}:${row.platform}`,
      row.checked_at ? new Date(row.checked_at).getTime() : 0,
    );
  }

  const candidates = buildCandidates(avatars as AvatarRow[], lastCheckedByKey, now);
  if (candidates.length === 0) return result;

  // Oldest / never-checked first — a stable rotation across cycles.
  candidates.sort((a, b) => (a.checkedAt ?? 0) - (b.checkedAt ?? 0));

  for (const candidate of candidates.slice(0, BATCH)) {
    const verdict = await probeAndStore(supabase, candidate);
    if (verdict === null) {
      result.skipped++;
      continue;
    }
    result.checked++;
    if (verdict === "active") result.active++;
    else if (verdict === "suspended") result.suspended++;
    else if (verdict === "notfound") result.notfound++;
  }

  return result;
}

function buildCandidates(
  avatars: AvatarRow[],
  lastCheckedByKey: Map<string, number>,
  now: number,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const avatar of avatars) {
    for (const platform of HEALTH_PLATFORMS) {
      if (!avatar[ENABLED_COLUMN[platform]]) continue;
      const handle = avatar[CRED_COLUMN[platform]]?.handle?.trim();
      if (!handle) continue;

      const checkedAt = lastCheckedByKey.get(`${avatar.id}:${platform}`) ?? null;
      // Fresh enough — skip until it goes stale.
      if (checkedAt !== null && now - checkedAt < STALE_MS) continue;

      candidates.push({
        avatarId: avatar.id,
        accountId: avatar.account_id,
        platform,
        handle,
        checkedAt,
      });
    }
  }
  return candidates;
}

/**
 * Probe one account and store its verdict. Returns the definitive status
 * (`active` / `suspended` / `notfound`), or `null` when the probe was
 * inconclusive — a transport failure OR an ambiguous `unknown` response.
 *
 * An inconclusive probe must NEVER clobber a prior good verdict (a transient
 * scraper glitch could otherwise flip a real `suspended` to `unknown` and hide
 * a dead account):
 *   - row already exists → bump `checked_at` only, preserving the status, so
 *     the staleness filter paces the retry;
 *   - never probed before → record a placeholder `unknown` (insert-if-absent)
 *     so the account leaves the "never checked" front of the queue instead of
 *     being re-selected every cycle.
 */
async function probeAndStore(
  supabase: ReturnType<typeof createAdminClient>,
  candidate: Candidate,
): Promise<AccountHealthStatus | null> {
  const health: AccountHealth | null =
    candidate.platform === "twitter"
      ? await getTwitterAccountHealth(candidate.handle)
      : await getTikTokAccountHealth(candidate.handle);

  const nowIso = new Date().toISOString();

  // Inconclusive = transport failure (null) OR an ambiguous `unknown` response.
  // Never let it clobber a prior good verdict.
  if (!health || health.status === "unknown") {
    if (candidate.checkedAt !== null) {
      // Existing row — keep its (possibly good) status, just pace the retry.
      await supabase
        .from("avatar_platform_health")
        .update({ checked_at: nowIso })
        .eq("avatar_id", candidate.avatarId)
        .eq("platform", candidate.platform);
    } else {
      // First-ever probe was inconclusive — record a placeholder so the account
      // leaves the "never checked" front of the queue, without overwriting a
      // concurrently-written row (ignoreDuplicates = insert-only).
      await supabase.from("avatar_platform_health").upsert(
        {
          avatar_id: candidate.avatarId,
          platform: candidate.platform,
          status: "unknown",
          followers: null,
          checked_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "avatar_id,platform", ignoreDuplicates: true },
      );
    }
    return null;
  }

  await supabase.from("avatar_platform_health").upsert(
    {
      avatar_id: candidate.avatarId,
      platform: candidate.platform,
      status: health.status,
      followers: health.followers,
      checked_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: "avatar_id,platform" },
  );

  if (health.status !== "active") {
    console.log(
      `[AccountHealth][${candidate.avatarId}] ${candidate.platform} ${health.status}`,
      JSON.stringify({ handle: candidate.handle }),
    );
  }

  return health.status;
}
