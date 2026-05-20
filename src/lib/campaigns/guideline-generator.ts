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
} from "./guideline-types";
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

const GENERATION_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 3_000;

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

  // 4) Parse + validate.
  const suggestion = parseAleriaJSONWithSchema(text, guidelineSuggestionSchema);

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
