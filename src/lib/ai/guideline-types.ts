import { z } from "zod";
import type { CampaignPlatform, GorgoneNetwork } from "@/types";

/**
 * Types and Zod schemas for the AI-driven guideline generator.
 *
 * The generator's contract:
 *   in  → GuidelineContext (zone description + posts sample +
 *         sentiment balance + top entities + locale)
 *   out → GuidelineSuggestion (3 strings + provenance metadata)
 *
 * The output schema doubles as a runtime guard for the LLM response —
 * `parseAleriaJSONWithSchema` rejects any payload that doesn't match.
 *
 * Lives under `lib/ai/` (not `lib/campaigns/`) so prompt builders in
 * `lib/ai/prompts/` can import these types without creating a
 * conceptual cycle (`lib/ai → lib/campaigns → lib/ai`). Domain code
 * in `lib/campaigns/` re-imports from here.
 */

// ---------------------------------------------------------------------------
// Context (input to the generator)
// ---------------------------------------------------------------------------

/**
 * Locale codes supported by Gorgone V4 (`accounts.locale` CHECK).
 * Mirrors `Locale` on the Gorgone side. Kept as a literal union here
 * so consumers can switch on it exhaustively.
 */
export const GUIDELINE_LOCALES = ["en", "fr", "es", "ar"] as const;
export type GuidelineLocale = (typeof GUIDELINE_LOCALES)[number];

/** Aleria-side sentiment label. Mirrors `SentimentLabel` from `@/types`. */
export type ContextSentimentLabel = "positive" | "negative" | "neutral";

/**
 * One representative post in the context sample. Trimmed and
 * normalised — never the raw upstream payload.
 */
export interface ContextPostSample {
  text: string;
  network: GorgoneNetwork;
  language: string | null;
  sentiment: ContextSentimentLabel | null;
  engagement: number;
}

/**
 * Sentiment distribution counts across the analysed window.
 * Helps the model frame strategy ("conversation skews negative — focus
 * on counter-narrative" vs. "conversation is positive — amplify").
 */
export interface ContextSentimentBalance {
  positive: number;
  negative: number;
  neutral: number;
  /** Posts that have no AI classification yet. Treated as "unknown". */
  unknown: number;
}

/**
 * Top entity surfaced in the zone — actors / organisations / places
 * the conversation actually revolves around.
 */
export interface ContextEntity {
  /** Detected entity name (e.g. "Macron", "Barakah", "IAEA"). */
  name: string;
  /** Entity kind from Gorgone NER (e.g. "PERSON", "ORG", "GPE"). */
  kind: string;
  occurrences: number;
}

export interface GuidelineContext {
  campaign: {
    name: string;
    platforms: CampaignPlatform[];
  };
  zone: {
    name: string;
    description: string | null;
  };
  /** `accounts.locale` of the Gorgone account owning the zone. */
  locale: GuidelineLocale;
  /** Window over which `posts` and `sentimentBalance` were computed. */
  windowHours: number;
  postsSampled: number;
  sentimentBalance: ContextSentimentBalance;
  posts: ContextPostSample[];
  topEntities: ContextEntity[];
}

// ---------------------------------------------------------------------------
// Output (LLM result)
// ---------------------------------------------------------------------------

const FIELD_MIN = 30;
const FIELD_MAX = 4000;

/**
 * LLMs occasionally return arrays for fields whose name reads plural
 * ("key_messages" → `["msg 1", "msg 2"]`). We accept both shapes and
 * normalise to a string at parse time so downstream code (DB column,
 * UI textarea) stays uniform. Arrays of objects (`[{ text: "..." }]`)
 * are also tolerated to cover the most common LLM drift.
 *
 * The post-transform value is enforced to be `FIELD_MIN..FIELD_MAX`
 * length — same bounds as if the model had produced a string from
 * the start.
 */
const guidelineFieldSchema = z
  .union([
    z.string(),
    z.array(z.string()),
    z.array(z.object({ text: z.string() }).passthrough()),
  ])
  .transform((value) => {
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      return (value as string[]).map((s) => `• ${s.trim()}`).join("\n").trim();
    }
    if (Array.isArray(value)) {
      return (value as { text: string }[])
        .map((v) => `• ${v.text.trim()}`)
        .join("\n")
        .trim();
    }
    return "";
  })
  .pipe(z.string().min(FIELD_MIN).max(FIELD_MAX));

/**
 * Schema for the LLM's JSON output — three strings, length-bounded so a
 * runaway generation can't blow up the campaign_posts text columns.
 *
 * Tolerant of array variants (see `guidelineFieldSchema`) — see the
 * comment there for why.
 */
export const guidelineSuggestionSchema = z.object({
  operational_context: guidelineFieldSchema,
  strategy: guidelineFieldSchema,
  key_messages: guidelineFieldSchema,
});

export type GuidelineSuggestion = z.infer<typeof guidelineSuggestionSchema>;

/**
 * Full result returned by the generator: the suggestion plus
 * provenance metadata so the caller can persist `generated_at`,
 * report cost / duration, and reason about the prompt version that
 * produced this output.
 */
export interface GuidelineGenerationResult {
  suggestion: GuidelineSuggestion;
  metadata: {
    /** Bumped whenever the prompt template changes. Logged for audit. */
    promptVersion: string;
    /** DISARM doctrine vendor stamp — see `disarm-doctrine.ts`. */
    doctrineVersion: string;
    locale: GuidelineLocale;
    postsSampled: number;
    durationMs: number;
  };
}
