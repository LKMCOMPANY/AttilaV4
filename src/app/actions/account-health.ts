"use server";

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import type { AvatarHealthSignals } from "@/lib/constants/account-health";
import {
  computeJobSignals,
  HEALTH_SIGNAL_WINDOW_MS,
  type JobSignalRow,
} from "@/lib/account-state/job-signals";

// ---------------------------------------------------------------------------
// Per-avatar health signals for the operator — the on-device / verification
// inputs the TikHub profile row can't provide, read from the account's recent
// jobs. The derivation itself lives in `@/lib/account-state/job-signals` so it
// is shared verbatim with the account-health worker's reconcile pass.
// ---------------------------------------------------------------------------

export async function getAvatarHealthSignals(
  accountId: string,
): Promise<Record<string, AvatarHealthSignals>> {
  const session = await requireSession();
  if (session.profile.role !== "admin" && accountId !== session.profile.account_id) {
    return {};
  }

  const supabase = await createClient();
  const since = new Date(Date.now() - HEALTH_SIGNAL_WINDOW_MS).toISOString();

  const { data } = await supabase
    .from("campaign_jobs")
    .select("avatar_id, platform, status, verification, error_message")
    .eq("account_id", accountId)
    .gte("completed_at", since)
    .order("completed_at", { ascending: false });

  if (!data) return {};
  return computeJobSignals(data as JobSignalRow[]);
}
