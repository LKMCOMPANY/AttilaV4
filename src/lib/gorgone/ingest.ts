import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostCreatedData } from "./webhook-payload";

/**
 * Webhook + sweep ingestion path — minimal ledger enqueue.
 *
 * V4 contract: the post body itself lives in Gorgone (`public.posts`).
 * Attila only stores the bookkeeping needed to drive the pipeline: which
 * Gorgone post belongs to which Attila account, when it was collected,
 * what its engagement is (so the claim ordering works without a re-fetch).
 *
 * Idempotence: `gorgone_post_jobs.gorgone_post_id` is PK + UNIQUE; the
 * `enqueue_gorgone_job` RPC uses ON CONFLICT DO NOTHING. Both webhook and
 * sweep can safely call this for the same post — only one row will exist.
 *
 * Account resolution: the payload carries the Gorgone `account_id`; we
 * look up the matching Attila account via `gorgone_links.gorgone_account_id`.
 * If no active link exists, we silently drop the event — events for
 * accounts we don't manage are not an error.
 */

export type IngestSource = "webhook" | "sweep";

export interface IngestOutcome {
  inserted: boolean;
  reason?: "no_link" | "duplicate" | "error";
  error?: string;
}

interface ResolvedAccount {
  account_id: string;
}

async function resolveAccountId(
  supabase: SupabaseClient,
  gorgoneAccountId: string,
): Promise<ResolvedAccount | null> {
  const { data } = await supabase
    .from("gorgone_links")
    .select("account_id")
    .eq("gorgone_account_id", gorgoneAccountId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return { account_id: data.account_id as string };
}

/**
 * Enqueues a single Gorgone post into Attila's ledger. Called by both the
 * webhook handler (push) and the sweep reconciler (pull) — same code path,
 * same idempotence guarantees.
 */
export async function enqueueGorgoneJob(
  supabase: SupabaseClient,
  payload: PostCreatedData,
  source: IngestSource,
): Promise<IngestOutcome> {
  const account = await resolveAccountId(supabase, payload.account_id);
  if (!account) return { inserted: false, reason: "no_link" };

  const { data, error } = await supabase.rpc("enqueue_gorgone_job", {
    p_gorgone_post_id: payload.post_id,
    p_gorgone_post_posted_at: payload.post_posted_at,
    p_account_id: account.account_id,
    p_zone_id: payload.zone_id,
    p_network: payload.network,
    p_kind: payload.kind,
    p_collected_at: payload.collected_at,
    p_total_engagement: payload.total_engagement,
    p_delivery_source: source,
  });

  if (error) {
    return { inserted: false, reason: "error", error: error.message };
  }

  return data === true
    ? { inserted: true }
    : { inserted: false, reason: "duplicate" };
}
