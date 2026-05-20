import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateCampaignGuidelines } from "@/lib/campaigns/guideline-generator";
import type { Campaign } from "@/types";

type CampaignRow = Campaign;

/**
 * POST /api/campaigns/auto-update-guidelines
 *
 * Cron-driven re-generation of campaign guidelines for every campaign
 * with `guidelines_auto_update = true` AND `status = 'active'`.
 *
 * Triggered by a Render cron (see `attila-cron-guidelines-update`).
 * Runs at low concurrency, sequentially, with a hard cap of
 * `MAX_CAMPAIGNS_PER_RUN` so an admin who flips 200 campaigns to
 * auto-update can't spike the LLM bill on a single tick.
 *
 * Conflict-avoidance contract (the manual-edit / auto-overwrite race
 * the operator was rightly concerned about):
 *   We skip a campaign whose `updated_at` is newer than its
 *   `guidelines_generated_at` by more than `MANUAL_EDIT_GRACE_MS`.
 *   That window means: if the operator edited any guideline (or any
 *   other campaign field) AFTER the last AI write, leave the manual
 *   text alone — the auto-update setting is opt-in but humans always
 *   win the merge.
 *
 * Auth: Bearer `CRON_SECRET` (same secret used by the Gorgone sweep
 * cron). Returns the per-campaign outcome list so the cron's logs
 * surface what was updated, what was skipped, and why.
 */

export const runtime = "nodejs";

const MAX_CAMPAIGNS_PER_RUN = 50;
const MANUAL_EDIT_GRACE_MS = 60_000; // 1 minute

interface OutcomeOk {
  campaignId: string;
  status: "updated";
  postsSampled: number;
  durationMs: number;
}
interface OutcomeSkip {
  campaignId: string;
  status: "skipped";
  reason: "manual_edit" | "no_zone_link";
}
interface OutcomeError {
  campaignId: string;
  status: "error";
  error: string;
}
type Outcome = OutcomeOk | OutcomeSkip | OutcomeError;

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization");
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const startedAt = Date.now();

  // 1) Fetch the candidate batch — partial index
  // `campaigns_auto_update_idx` makes this a cheap range scan.
  const { data: candidates, error: fetchErr } = await supabase
    .from("campaigns")
    .select("*")
    .eq("guidelines_auto_update", true)
    .eq("status", "active")
    .order("guidelines_generated_at", { ascending: true, nullsFirst: true })
    .limit(MAX_CAMPAIGNS_PER_RUN);

  if (fetchErr) {
    return NextResponse.json(
      { ok: false, action: "error", error: fetchErr.message },
      { status: 500 },
    );
  }

  const rows = (candidates ?? []) as CampaignRow[];
  const outcomes: Outcome[] = [];

  // 2) Per-campaign loop. Sequential to keep LLM concurrency bounded
  // (Aleria has a single shared rate limit). Soft-fail per campaign:
  // one rejection never aborts the batch.
  for (const campaign of rows) {
    if (wasManuallyEditedSinceLastGeneration(campaign)) {
      outcomes.push({
        campaignId: campaign.id,
        status: "skipped",
        reason: "manual_edit",
      });
      continue;
    }

    const gorgoneAccountId = await resolveGorgoneAccount(
      supabase,
      campaign.account_id,
    );
    if (!gorgoneAccountId) {
      outcomes.push({
        campaignId: campaign.id,
        status: "skipped",
        reason: "no_zone_link",
      });
      continue;
    }

    try {
      const result = await generateCampaignGuidelines({
        campaign: {
          id: campaign.id,
          name: campaign.name,
          platforms: campaign.platforms,
          gorgone_zone_id: campaign.gorgone_zone_id,
        },
        gorgoneAccountId,
      });

      const { error: updErr } = await supabase
        .from("campaigns")
        .update({
          operational_context: result.suggestion.operational_context,
          strategy: result.suggestion.strategy,
          key_messages: result.suggestion.key_messages,
          guidelines_generated_at: new Date().toISOString(),
        })
        .eq("id", campaign.id);

      if (updErr) {
        outcomes.push({
          campaignId: campaign.id,
          status: "error",
          error: `update: ${updErr.message}`,
        });
        continue;
      }

      outcomes.push({
        campaignId: campaign.id,
        status: "updated",
        postsSampled: result.metadata.postsSampled,
        durationMs: result.metadata.durationMs,
      });
    } catch (err) {
      outcomes.push({
        campaignId: campaign.id,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary = summarise(outcomes);
  return NextResponse.json({
    ok: true,
    action: summary.updated > 0 ? "updated" : "idle",
    duration_ms: Date.now() - startedAt,
    candidates: rows.length,
    ...summary,
    outcomes,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Manual-edit detection — see contract in the file header. We compare
 * `updated_at` (any column write) against `guidelines_generated_at`
 * (last AI write) with a 1-minute grace so the AI write itself, which
 * also bumps `updated_at`, doesn't trigger a false skip on the very
 * next run.
 */
function wasManuallyEditedSinceLastGeneration(campaign: CampaignRow): boolean {
  if (!campaign.guidelines_generated_at) return false;
  const updated = new Date(campaign.updated_at).getTime();
  const generated = new Date(campaign.guidelines_generated_at).getTime();
  return updated > generated + MANUAL_EDIT_GRACE_MS;
}

async function resolveGorgoneAccount(
  supabase: ReturnType<typeof createAdminClient>,
  attilaAccountId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("gorgone_links")
    .select("gorgone_account_id")
    .eq("account_id", attilaAccountId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.gorgone_account_id as string | undefined) ?? null;
}

function summarise(outcomes: Outcome[]) {
  let updated = 0;
  let skipped = 0;
  let errored = 0;
  for (const o of outcomes) {
    if (o.status === "updated") updated += 1;
    else if (o.status === "skipped") skipped += 1;
    else errored += 1;
  }
  return { updated, skipped, errored };
}
