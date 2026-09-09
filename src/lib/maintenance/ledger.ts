/**
 * `avatar_actions` — the one ledger of what an avatar did on a platform.
 *
 * Every real action (a reply the Automator posted, a like or a follow the
 * maintainer made, a login) is one row, dated in the DEVICE's local day so
 * daily caps mean "today for this persona", not "today in UTC". The
 * Automator and the maintainer write here; both read `dailyCounts` before
 * acting. Writes are idempotent on (ref_kind, ref_id, action).
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import type { AvatarActionKind, AvatarActor, SocialPlatform } from "@/types";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface RecordActionInput {
  accountId: string;
  avatarId: string;
  platform: SocialPlatform;
  action: AvatarActionKind;
  actor: AvatarActor;
  /** Used to resolve the device's timezone for `local_date`. */
  deviceId?: string | null;
  /** Explicit timezone when the caller already has it (skips the lookup). */
  timezone?: string | null;
  refKind?: "campaign_job" | "maintenance_task" | "manual";
  refId?: string | null;
  target?: string | null;
  occurredAt?: Date;
}

/** `YYYY-MM-DD` of `at` in `timezone` (falls back to UTC on an unknown zone). */
export function localDate(at: Date, timezone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** Append one action. Never throws — a ledger miss must not fail the action itself. */
export async function recordAvatarAction(supabase: AdminClient, input: RecordActionInput): Promise<void> {
  const at = input.occurredAt ?? new Date();
  let timezone = input.timezone ?? null;
  if (!timezone && input.deviceId) {
    const { data } = await supabase.from("devices").select("timezone").eq("id", input.deviceId).maybeSingle();
    timezone = data?.timezone ?? null;
  }
  const { error } = await supabase.from("avatar_actions").upsert(
    {
      account_id: input.accountId,
      avatar_id: input.avatarId,
      platform: input.platform,
      action: input.action,
      actor: input.actor,
      occurred_at: at.toISOString(),
      local_date: localDate(at, timezone),
      ref_kind: input.refKind ?? null,
      ref_id: input.refId ?? null,
      target: input.target ?? null,
    },
    { onConflict: "ref_kind,ref_id,action", ignoreDuplicates: true },
  );
  if (error) {
    console.error(`[Ledger] avatar_actions insert failed for ${input.avatarId}/${input.platform}: ${error.message}`);
  }
}

export type DailyCounts = Partial<Record<AvatarActionKind, number>>;

/** Actions already taken today (device-local) by an avatar on a platform. */
export async function dailyCounts(
  supabase: AdminClient,
  avatarId: string,
  platform: SocialPlatform,
  timezone: string | null | undefined,
  now = new Date(),
): Promise<DailyCounts> {
  const { data } = await supabase
    .from("avatar_actions")
    .select("action")
    .eq("avatar_id", avatarId)
    .eq("platform", platform)
    .eq("local_date", localDate(now, timezone));
  const counts: DailyCounts = {};
  for (const row of data ?? []) {
    const kind = row.action as AvatarActionKind;
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}
