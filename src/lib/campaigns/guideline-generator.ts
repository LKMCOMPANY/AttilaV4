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
 * 32 000 tokens. Successive bumps as we learnt more about Aleria's
 * reasoning behaviour on this synthesis task:
 *   - 3 000 (initial)  → JSON truncated mid-string (~1.3 KB out)
 *   - 8 000            → "empty content — reasoning consumed all"
 *                         (the chain-of-thought ate the whole budget)
 *   - 16 000           → STILL truncated at ~1.1 KB — the reasoning
 *                         chain on this prompt eats more than 13 K
 *                         tokens before yielding visible output
 *   - 32 000 (this)    → 2× the previous ceiling. The error logger
 *                         now also captures `finishReason` and
 *                         `usage` so the next failure tells us
 *                         exactly which knob to turn (length cap
 *                         vs. content-filter vs. server-side limit).
 *
 * Aleria is hosted on our own workers — there's no $-per-token
 * pressure. The only reason not to set this even higher is that an
 * unbounded budget would make a hung reasoning loop visible only as
 * a timeout instead of an OOM. 32 K stays well within Aleria's
 * context window.
 *
 * `analyst.ts` keeps 2 000 because its output is one tiny JSON
 * (`{relevant, reason, count}`) — the orders of magnitude are
 * intentionally different.
 */
const MAX_OUTPUT_TOKENS = 32_000;

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
  //
  // NOTE — direct fetch instead of `generateText` from `ai`:
  //   The AI SDK was producing systematically truncated responses on
  //   THIS prompt in production (1.0–1.3 KB visible output, malformed
  //   JSON), while a `curl` against the same Aleria endpoint with the
  //   same model + max_tokens completed cleanly (5+ KB, finish=stop).
  //   Bypassing the SDK gives us full control over the request shape
  //   and surfaces `finish_reason` + `usage` so a future regression
  //   stays diagnosable. The analyst + writer paths still use
  //   `generateText` because their tiny outputs never tripped the bug.
  //
  // We log `finishReason` and `usage` explicitly so an operator can
  // tell at a glance whether a future failure is a length cap, a
  // content filter, or a malformed model output.
  let text: string;
  let finishReason: string | undefined;
  let usage: unknown;
  try {
    const aleriaResp = await withTimeout(
      callAleriaChatCompletion(system, user),
      GENERATION_TIMEOUT_MS,
      "GuidelineGenerator",
    );
    text = aleriaResp.text;
    finishReason = aleriaResp.finishReason;
    usage = aleriaResp.usage;
  } catch (err) {
    console.error(`${LOG_PREFIX}[${campaign.id}] Aleria call failed`, err);
    throw err;
  }

  if (!text || text.trim().length === 0) {
    const msg = `Aleria returned empty content (finish_reason=${finishReason ?? "unknown"})`;
    console.error(`${LOG_PREFIX}[${campaign.id}] ${msg}`, { usage });
    throw new Error(msg);
  }

  if (finishReason && finishReason !== "stop") {
    console.warn(
      `${LOG_PREFIX}[${campaign.id}] non-stop finish_reason=${finishReason} — output may be truncated`,
      { usage, textLen: text.length },
    );
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

// ---------------------------------------------------------------------------
// Direct Aleria chat-completion call
// ---------------------------------------------------------------------------

interface AleriaResponse {
  text: string;
  finishReason: string | undefined;
  usage: unknown;
}

/**
 * Calls Aleria's `/v1/chat/completions` endpoint directly.
 *
 * Why direct fetch instead of the AI SDK's `generateText`:
 *   On this synthesis prompt (DISARM doctrine + 60 posts + 25
 *   entities ≈ 3 K input tokens), the AI SDK in production
 *   produced systematically truncated responses (1.0–1.3 KB
 *   visible output, malformed JSON), while a direct curl with
 *   the same model + max_tokens completed cleanly (5+ KB,
 *   finish=stop). Direct fetch removes the abstraction layer
 *   that was eating output mid-flight and lets us surface
 *   `finish_reason` + `usage` for every call.
 *
 * The function throws on HTTP errors and on missing-field
 * responses; the caller wraps with `withTimeout` for a hard
 * 5-min ceiling.
 */
async function callAleriaChatCompletion(
  systemPrompt: string,
  userPrompt: string,
): Promise<AleriaResponse> {
  const baseURL = process.env.ALERIA_BASE_URL;
  const apiKey = process.env.ALERIA_API_KEY;
  if (!baseURL || !apiKey) {
    throw new Error("Missing ALERIA_BASE_URL or ALERIA_API_KEY env vars");
  }

  const res = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "aleria",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: MAX_OUTPUT_TOKENS,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Aleria HTTP ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: unknown;
    error?: { message?: string };
  };

  if (json.error?.message) {
    throw new Error(`Aleria API error: ${json.error.message}`);
  }

  const choice = json.choices?.[0];
  return {
    text: choice?.message?.content ?? "",
    finishReason: choice?.finish_reason,
    usage: json.usage,
  };
}
