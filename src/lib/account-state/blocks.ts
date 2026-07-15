import { createAdminClient } from "@/lib/supabase/admin";
import { broadcastAccountEvent } from "@/lib/supabase/realtime";
import {
  deriveAccountHealth,
  isBlockingKind,
  blockDescriptorFromKind,
  HEALTH_PLATFORMS,
} from "@/lib/constants/account-health";
import {
  computeJobSignals,
  HEALTH_SIGNAL_WINDOW_MS,
  DEVICE_ISSUE_BY_CATEGORY,
  type JobSignalRow,
} from "./job-signals";
import type {
  AvatarBlockReason,
  AvatarBlockSource,
  AccountHealthStatus,
  SocialPlatform,
} from "@/types";

// ---------------------------------------------------------------------------
// avatar_platform_blocks — write + reconcile side.
//
// The table is the single gate for Automator selection (an ACTIVE row, i.e.
// resolved_at IS NULL, means "not callable on this platform"). Two producers:
//   - the pipeline executor writes CERTAIN on-device blocks (logged_out /
//     blocked / captcha) the moment a job fails on an account screen;
//   - the account-health worker reconciles DERIVED blocks (TikHub suspended /
//     notfound-without-confirmation / shadow-ban) for the avatars it probes,
//     and auto-recovers its own blocks when the signal clears.
// On-device / operator blocks are cleared ONLY by a human ("Mark resolved").
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

// After an operator (or auto) resolve, a derived block is not reopened for this
// long — gives an operator's fix time to reflect in the next TikHub probe and
// prevents flapping right after a resolve.
const RESOLVE_GRACE_MS = 24 * 60 * 60 * 1000;

/** Automation error category → block reason, or null when it isn't account-level. */
export function blockReasonFromErrorCategory(
  category: string | undefined,
): AvatarBlockReason | null {
  if (!category) return null;
  return (DEVICE_ISSUE_BY_CATEGORY[category] as AvatarBlockReason | undefined) ?? null;
}

/**
 * Open (or refresh) an active block for a (avatar, platform). Idempotent: the
 * partial unique index guarantees at most one active row, so a concurrent
 * double-open is caught and folded into a `last_detected_at` bump.
 */
export async function openBlock(
  supabase: AdminClient,
  params: {
    avatarId: string;
    platform: SocialPlatform;
    reason: AvatarBlockReason;
    source: AvatarBlockSource;
    detail?: string | null;
    jobId?: string | null;
  },
): Promise<void> {
  const { avatarId, platform, reason, source, detail = null, jobId = null } = params;
  const nowIso = new Date().toISOString();

  const { error } = await supabase.from("avatar_platform_blocks").insert({
    avatar_id: avatarId,
    platform,
    reason,
    source,
    detail,
    job_id: jobId,
    first_detected_at: nowIso,
    last_detected_at: nowIso,
  });

  if (!error) return;

  // 23505 = an active block already exists (partial unique index) → refresh it.
  if (error.code === "23505") {
    await supabase
      .from("avatar_platform_blocks")
      .update({ last_detected_at: nowIso, detail, updated_at: nowIso })
      .eq("avatar_id", avatarId)
      .eq("platform", platform)
      .is("resolved_at", null);
    return;
  }

  console.error(
    `[blocks] Failed to open block ${avatarId}/${platform}/${reason}: ${error.message}`,
  );
}

/**
 * Resolve the active block for a (avatar, platform), making it callable again.
 * Returns true when a block was actually cleared. `resolvedBy` is null for
 * automatic (worker) recoveries.
 */
export async function closeBlock(
  supabase: AdminClient,
  params: { avatarId: string; platform: SocialPlatform; resolvedBy?: string | null },
): Promise<boolean> {
  const { avatarId, platform, resolvedBy = null } = params;
  const nowIso = new Date().toISOString();

  const { data } = await supabase
    .from("avatar_platform_blocks")
    .update({ resolved_at: nowIso, resolved_by: resolvedBy, updated_at: nowIso })
    .eq("avatar_id", avatarId)
    .eq("platform", platform)
    .is("resolved_at", null)
    .select("id");

  return (data?.length ?? 0) > 0;
}

/**
 * Selector gate: the subset of `avatarIds` that currently have an ACTIVE block
 * on `platform` (so they must be skipped). One indexed query.
 */
export async function getActiveBlockedAvatarIds(
  supabase: AdminClient,
  platform: SocialPlatform,
  avatarIds: string[],
): Promise<Set<string>> {
  if (avatarIds.length === 0) return new Set();
  const { data } = await supabase
    .from("avatar_platform_blocks")
    .select("avatar_id")
    .eq("platform", platform)
    .is("resolved_at", null)
    .in("avatar_id", avatarIds);
  return new Set((data ?? []).map((r) => r.avatar_id as string));
}

interface ActiveBlockRow {
  avatar_id: string;
  platform: SocialPlatform;
  source: AvatarBlockSource;
  reason: AvatarBlockReason;
}

/**
 * Reconcile DERIVED blocks (TikHub + shadow-ban) for a batch of just-probed
 * avatars: open a block when a blocking verdict appears, auto-close the
 * worker's own block when the signal clears. Never touches on-device / operator
 * blocks — those are a human's to resolve. Broadcasts a realtime tick for every
 * account whose blocks changed, and returns the opened/closed counts.
 */
export async function reconcileAvatarBlocks(
  supabase: AdminClient,
  avatarIds: string[],
): Promise<{ opened: number; closed: number }> {
  if (avatarIds.length === 0) return { opened: 0, closed: 0 };

  const [avatarsRes, healthRes, jobsRes, activeRes, resolvedRes] = await Promise.all([
    supabase.from("avatars").select("id, account_id").in("id", avatarIds),
    supabase
      .from("avatar_platform_health")
      .select("avatar_id, platform, status")
      .in("avatar_id", avatarIds),
    supabase
      .from("campaign_jobs")
      .select("avatar_id, platform, status, verification, error_message")
      .in("avatar_id", avatarIds)
      .gte("completed_at", new Date(Date.now() - HEALTH_SIGNAL_WINDOW_MS).toISOString())
      .order("completed_at", { ascending: false }),
    supabase
      .from("avatar_platform_blocks")
      .select("avatar_id, platform, source, reason")
      .is("resolved_at", null)
      .in("avatar_id", avatarIds),
    supabase
      .from("avatar_platform_blocks")
      .select("avatar_id, platform")
      .gt("resolved_at", new Date(Date.now() - RESOLVE_GRACE_MS).toISOString())
      .in("avatar_id", avatarIds),
  ]);

  const accountByAvatar = new Map<string, string>();
  for (const a of avatarsRes.data ?? [])
    accountByAvatar.set(a.id as string, a.account_id as string);

  const healthByKey = new Map<string, AccountHealthStatus>();
  for (const h of healthRes.data ?? [])
    healthByKey.set(`${h.avatar_id}:${h.platform}`, h.status as AccountHealthStatus);

  const signals = computeJobSignals((jobsRes.data ?? []) as JobSignalRow[]);

  const activeByKey = new Map<string, ActiveBlockRow>();
  for (const b of (activeRes.data ?? []) as ActiveBlockRow[])
    activeByKey.set(`${b.avatar_id}:${b.platform}`, b);

  const recentlyResolved = new Set<string>();
  for (const r of resolvedRes.data ?? [])
    recentlyResolved.add(`${r.avatar_id}:${r.platform}`);

  let opened = 0;
  let closed = 0;
  const affected = new Set<string>();

  for (const avatarId of avatarIds) {
    for (const platform of HEALTH_PLATFORMS) {
      const key = `${avatarId}:${platform}`;
      const sig = signals[avatarId]?.[platform];
      // On-device evidence is the executor's job — reconcile only judges the
      // off-device / verification signals, so deviceIssue is deliberately omitted.
      const kind = deriveAccountHealth({
        tikhub: healthByKey.get(key),
        shadowBan: sig?.shadowBan,
        confirmed: sig?.confirmed,
      });
      // The gating policy is the shared predicate — one definition for the
      // selector-facing set, the UI and this reconcile pass.
      const desired = isBlockingKind(kind) ? blockDescriptorFromKind(kind) : null;
      const existing = activeByKey.get(key);

      if (desired) {
        if (existing) continue; // already blocked (any source) — leave it
        if (recentlyResolved.has(key)) continue; // anti-flap after a resolve
        await openBlock(supabase, {
          avatarId,
          platform,
          reason: desired.reason,
          source: desired.source,
          detail: reconcileDetail(desired.reason),
        });
        opened++;
        const acc = accountByAvatar.get(avatarId);
        if (acc) affected.add(acc);
      } else if (existing && (existing.source === "tikhub" || existing.source === "verification")) {
        // Signal cleared — auto-recover the worker's own block only.
        const didClose = await closeBlock(supabase, { avatarId, platform });
        if (didClose) {
          closed++;
          const acc = accountByAvatar.get(avatarId);
          if (acc) affected.add(acc);
        }
      }
    }
  }

  for (const accountId of affected) {
    broadcastAccountEvent(accountId, "jobs", { action: "blocks_reconciled" });
  }

  return { opened, closed };
}

function reconcileDetail(reason: AvatarBlockReason): string {
  switch (reason) {
    case "suspended":
      return "TikHub reports the account suspended.";
    case "notfound":
      return "TikHub can't find this @handle and no post was ever confirmed.";
    case "shadow_ban":
      return "Posts left the device but none were confirmed live (likely shadow-ban).";
    default:
      return "";
  }
}
