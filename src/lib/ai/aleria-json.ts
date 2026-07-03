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

  // Aleria sometimes appends prose after the JSON object (e.g. a closing
  // explanation), which makes a strict `JSON.parse` of the whole string throw
  // "Unexpected non-whitespace character after JSON". Parse the first balanced
  // JSON object/array instead so trailing commentary never loses a post.
  const candidate = extractFirstJsonValue(cleaned) ?? cleaned;

  try {
    return JSON.parse(candidate) as T;
  } catch (err) {
    const preview = cleaned.slice(0, 200).replace(/\s+/g, " ");
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Aleria JSON parse failed (${message}): ${preview}`);
  }
}

/**
 * Return the first balanced JSON object/array substring in `text`, or null if
 * none. Scans with brace/bracket depth while respecting string literals and
 * escapes, so braces inside string values don't confuse the matcher.
 */
function extractFirstJsonValue(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;

  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // unbalanced — let the caller surface the parse error
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
