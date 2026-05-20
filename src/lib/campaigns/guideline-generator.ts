import { generateText } from "ai";
import { getAleriaModel } from "@/lib/ai/client";
import { parseAleriaJSONWithSchema } from "@/lib/ai/aleria-json";
import {
  DISARM_DOCTRINE_VERSION,
} from "@/lib/ai/prompts/disarm-doctrine";
import {
  GUIDELINE_PROMPT_VERSION,
  buildGuidelineSystemPrompt,
  buildGuidelineUserPrompt,
} from "@/lib/ai/prompts/guideline-prompt";
import { withTimeout } from "@/lib/pipeline/types";
import { buildGuidelineContext } from "./guideline-context";
import {
  guidelineSuggestionSchema,
  type GuidelineGenerationResult,
} from "@/lib/ai/guideline-types";
import type { Campaign } from "@/types";

const LOG_PREFIX = "[guideline-gen]";

/**
 * Single entry point for AI-driven campaign-guideline generation.
 *
 * Orchestrates:
 *   1. Snapshot of zone context from Gorgone V4 (delegated to
 *      `guideline-context.ts`).
 *   2. Prompt assembly (pure functions in `lib/ai/prompts/...`).
 *   3. Aleria call via the OpenAI-compatible client used everywhere
 *      else in the pipeline (`lib/ai/client.ts`).
 *   4. JSON parse + Zod validation (shared helper).
 *   5. Structured logging + provenance metadata.
 *
 * Failure surface:
 *   - Aleria timeout → wrapped via `withTimeout` (60 s).
 *   - Empty completion → explicit Error so the caller can surface a
 *     "AI returned no content" toast.
 *   - Schema mismatch → Error with the failing path + 200-char preview
 *     of what the model actually said (from `parseAleriaJSONWithSchema`).
 *
 * No try/catch swallowing — the caller (server action) wraps the
 * whole thing and converts to `{ data, error }`. Keeping errors
 * propagating up means we never lose stack traces in logs.
 */

/**
 * 5-minute hard ceiling. Aleria runs on our own workers — there is
 * no cost pressure to short-cut the call, and richer context (60
 * posts + 25 entities + the DISARM doctrine) produces measurably
 * better guidelines than a thinner prompt. The ceiling exists only
 * so a wedged worker can never hold a request indefinitely.
 *
 * Compare with `analyst.ts` / `writer.ts` (60 s) — those handle a
 * single post; this one is a heavy synthesis call.
 *
 * The cron caller (`auto-update-guidelines`) loops sequentially with
 * `MAX_CAMPAIGNS_PER_RUN = 50`, so even a worst-case 5-min campaign
 * cannot drag the batch beyond a 250 m soft budget — the cron is
 * scheduled daily, plenty of headroom.
 */
const GENERATION_TIMEOUT_MS = 300_000;
/**
 * 16 000 tokens. Successive bumps as we learnt more about Aleria's
 * reasoning behaviour on this synthesis task:
 *   - 3 000 (initial)  → JSON truncated mid-string (~1.3 KB out)
 *   - 8 000            → "empty content — reasoning consumed all"
 *                         (the chain-of-thought ate the whole budget)
 *   - 16 000 (this)    → ≈ 4× the worst-case visible output
 *                         (3 fields × 4 000 chars ≈ 3 000 tokens),
 *                         leaving 13 000 for the reasoning chain.
 *
 * Aleria is hosted on our own workers — there's no $-per-token
 * pressure. The only reason not to set this even higher is that an
 * unbounded budget would make a hung reasoning loop visible only as
 * a timeout instead of an OOM. 16 K is comfortable today; bump
 * again if production logs show another empty-content run.
 *
 * `analyst.ts` keeps 2 000 because its output is one tiny JSON
 * (`{relevant, reason, count}`) — the orders of magnitude are
 * intentionally different.
 */
const MAX_OUTPUT_TOKENS = 16_000;

export interface GenerateCampaignGuidelinesInput {
  campaign: Pick<Campaign, "id" | "name" | "platforms" | "gorgone_zone_id">;
  /** Resolved by the caller (server action) from `gorgone_links`. */
  gorgoneAccountId: string;
}

export async function generateCampaignGuidelines(
  input: GenerateCampaignGuidelinesInput,
): Promise<GuidelineGenerationResult> {
  const start = Date.now();
  const { campaign, gorgoneAccountId } = input;

  // 1) Context snapshot — Supabase reads against Gorgone V4.
  const context = await buildGuidelineContext({
    campaign: {
      name: campaign.name,
      platforms: campaign.platforms,
    },
    zoneId: campaign.gorgone_zone_id,
    gorgoneAccountId,
  });

  // 2) Prompt assembly.
  const system = buildGuidelineSystemPrompt(context.locale);
  const user = buildGuidelineUserPrompt(context);

  // 3) Aleria call.
  let text: string;
  try {
    const result = await withTimeout(
      generateText({
        model: getAleriaModel("aleria"),
        system,
        prompt: user,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      }),
      GENERATION_TIMEOUT_MS,
      "GuidelineGenerator",
    );
    text = result.text;
  } catch (err) {
    console.error(`${LOG_PREFIX}[${campaign.id}] Aleria call failed`, err);
    throw err;
  }

  if (!text || text.trim().length === 0) {
    const msg = "Aleria returned empty content — reasoning consumed all tokens";
    console.error(`${LOG_PREFIX}[${campaign.id}] ${msg}`);
    throw new Error(msg);
  }

  // 4) Parse + validate. We catch + log explicitly so the server has a
  // record of what Aleria actually returned when the schema rejects —
  // the action layer maps the error to a friendly message for the UI,
  // but a Render log is the only way for an operator to see the raw
  // model output and adjust the prompt.
  let suggestion;
  try {
    suggestion = parseAleriaJSONWithSchema(text, guidelineSuggestionSchema);
  } catch (err) {
    const preview = text.slice(0, 800).replace(/\s+/g, " ");
    console.error(
      `${LOG_PREFIX}[${campaign.id}] Schema mismatch — Aleria raw preview: ${preview}`,
      err,
    );
    throw err;
  }

  const durationMs = Date.now() - start;
  console.log(`${LOG_PREFIX}[${campaign.id}] Generated`, {
    locale: context.locale,
    postsSampled: context.postsSampled,
    entitiesUsed: context.topEntities.length,
    durationMs,
    promptVersion: GUIDELINE_PROMPT_VERSION,
    doctrineVersion: DISARM_DOCTRINE_VERSION,
  });

  return {
    suggestion,
    metadata: {
      promptVersion: GUIDELINE_PROMPT_VERSION,
      doctrineVersion: DISARM_DOCTRINE_VERSION,
      locale: context.locale,
      postsSampled: context.postsSampled,
      durationMs,
    },
  };
}
