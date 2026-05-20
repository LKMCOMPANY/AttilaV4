import type { z } from "zod";

/**
 * Aleria LLM JSON output helpers.
 *
 * Aleria sometimes wraps its JSON output in a markdown code fence
 * (``` or ```json) — the same pattern most OpenAI-compatible providers
 * exhibit when the system prompt asks for JSON without using a strict
 * `response_format`. These helpers strip the fence, trim whitespace,
 * and validate the resulting object against a Zod schema so consumers
 * never have to re-implement the same parsing dance.
 *
 * Consumers:
 *   - `lib/pipeline/analyst.ts` — campaign post relevance decision
 *   - `lib/campaigns/guideline-generator.ts` — guideline triple generation
 */

/**
 * Strips the optional ```json / ``` wrapper Aleria sometimes emits and
 * returns the parsed object. Throws with a leading 200-char preview of
 * the raw text on failure so the error message stays diagnostic
 * without leaking arbitrarily long LLM output into logs.
 */
export function parseAleriaJSON<T = unknown>(content: string): T {
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    const preview = cleaned.slice(0, 200).replace(/\s+/g, " ");
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Aleria JSON parse failed (${message}): ${preview}`);
  }
}

/**
 * Same as `parseAleriaJSON` but additionally validates the parsed
 * object against a Zod schema. Returns the typed, validated value.
 *
 * On failure the error message includes:
 *   - the failing field path (Zod issue)
 *   - the first 200 chars of the raw output (so an operator can see
 *     what the model actually produced)
 *
 * Use this for any output that's consumed structurally (vs. a freeform
 * string). The Zod schema doubles as runtime guard + TS type source.
 */
export function parseAleriaJSONWithSchema<T>(
  content: string,
  schema: z.ZodType<T>,
): T {
  const raw = parseAleriaJSON(content);
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const issues = parsed.error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
  const preview = JSON.stringify(raw).slice(0, 200);
  throw new Error(`Aleria output schema mismatch [${issues}] — got: ${preview}`);
}
