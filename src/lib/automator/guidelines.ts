import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RequestSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateCampaignGuidelines as runGuidelineGeneration } from "@/lib/campaigns/guideline-generator";
import type { GuidelineGenerationResult } from "@/lib/ai/guideline-types";
import { SUPPORTED_GORGONE_NETWORKS, type SupportedGorgoneNetwork } from "@/types";

/**
 * AI guideline generation core — the single implementation behind the
 * Server Action (`src/app/actions/campaigns.ts`) and the native REST
 * route (`/api/campaigns/guidelines/generate`). Does NOT persist — the
 * caller shows the suggestion in a preview and applies it through the
 * campaign update path.
 */

// ---------------------------------------------------------------------------
// Input — discriminated union shared by both transports
// ---------------------------------------------------------------------------

/**
 * `saved` mode: server reads the campaign row, runs the gen.
 * `draft` mode: caller passes the not-yet-persisted fields inline
 * (creation wizard — the operator hasn't saved the draft).
 *
 * The two modes share a single resolver below — the only difference is
 * where the (account_id, name, platforms, gorgone_zone_id) tuple comes
 * from. Both go through the same auth + Gorgone-link resolution path
 * so there is zero security or behaviour drift.
 */
export const generateGuidelinesSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("saved"),
    campaignId: z.string().uuid(),
  }),
  z.object({
    mode: z.literal("draft"),
    accountId: z.string().uuid(),
    name: z.string().min(1).max(200).trim(),
    platforms: z.array(z.enum(SUPPORTED_GORGONE_NETWORKS)).min(1),
    gorgoneZoneId: z.string().uuid(),
  }),
]);

export type GenerateGuidelinesInput = z.input<typeof generateGuidelinesSchema>;

/**
 * Public shape returned to the UI:
 *   - `suggestion`  the three strings ready to be applied
 *   - `metadata`    provenance for an audit trail (locale, postsSampled,
 *                   durationMs, prompt + doctrine version)
 */
export type GenerateGuidelinesResponse = GuidelineGenerationResult;

interface ResolvedTarget {
  accountId: string;
  name: string;
  platforms: SupportedGorgoneNetwork[];
  gorgoneZoneId: string;
  /** UUID of the campaign row when `mode='saved'`, null otherwise. */
  campaignId: string | null;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export async function generateGuidelinesCore(
  ctx: RequestSession,
  input: GenerateGuidelinesInput,
): Promise<{ data: GenerateGuidelinesResponse | null; error: string | null }> {
  const { session, supabase } = ctx;

  const parsed = generateGuidelinesSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.issues[0].message };
  }

  const target = await resolveGenerationTarget(supabase, parsed.data);
  if (!target.value) return { data: null, error: target.error };
  const t = target.value;

  // Authorisation — same shape as every other campaign action.
  if (
    session.profile.role !== "admin" &&
    t.accountId !== session.profile.account_id
  ) {
    return { data: null, error: "Forbidden" };
  }

  // Resolve the Gorgone V4 account uuid via the link table.
  const adminSupabase = createAdminClient();
  const { data: link } = await adminSupabase
    .from("gorgone_links")
    .select("gorgone_account_id")
    .eq("account_id", t.accountId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const gorgoneAccountId = link?.gorgone_account_id as string | undefined;
  if (!gorgoneAccountId) {
    return {
      data: null,
      error: "No active Gorgone link for this account",
    };
  }

  try {
    const result = await runGuidelineGeneration({
      campaign: {
        id: t.campaignId ?? "draft",
        name: t.name,
        platforms: t.platforms,
        gorgone_zone_id: t.gorgoneZoneId,
      },
      gorgoneAccountId,
    });
    return { data: result, error: null };
  } catch (err) {
    return { data: null, error: friendlyGenerationError(err) };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Translates the various failure modes of the LLM call into one of
 * three user-facing messages — the operator does not need (and should
 * not see) Zod stack traces or token counts. Full error stays in the
 * server console (`guideline-generator.ts` already logs it).
 */
function friendlyGenerationError(err: unknown): string {
  const raw = err instanceof Error ? err.message : "Unknown error";
  if (/timed out|timeout|abort/i.test(raw)) {
    return "AI generation timed out. Try again in a moment.";
  }
  if (/schema mismatch|JSON parse failed/i.test(raw)) {
    return "AI returned an unexpected format. Please try again.";
  }
  if (/empty content/i.test(raw)) {
    return "AI returned no content. Please try again.";
  }
  return "AI generation failed. Please try again.";
}

async function resolveGenerationTarget(
  supabase: SupabaseClient,
  input: z.infer<typeof generateGuidelinesSchema>,
): Promise<{ value: ResolvedTarget; error: null } | { value: null; error: string }> {
  if (input.mode === "saved") {
    const { data: campaign, error } = await supabase
      .from("campaigns")
      .select("id, account_id, name, platforms, gorgone_zone_id")
      .eq("id", input.campaignId)
      .single();

    if (error || !campaign) {
      return { value: null, error: "Campaign not found" };
    }
    return {
      value: {
        accountId: campaign.account_id as string,
        name: campaign.name as string,
        platforms: campaign.platforms as SupportedGorgoneNetwork[],
        gorgoneZoneId: campaign.gorgone_zone_id as string,
        campaignId: campaign.id as string,
      },
      error: null,
    };
  }

  // draft mode — inline fields
  return {
    value: {
      accountId: input.accountId,
      name: input.name,
      platforms: input.platforms,
      gorgoneZoneId: input.gorgoneZoneId,
      campaignId: null,
    },
    error: null,
  };
}
