/**
 * Bidirectional-text helpers for the publish path.
 *
 * Why this exists
 * ---------------
 * The writer produces correct, logical-order Arabic and ADBKeyboard types it
 * faithfully — but Android text views (and therefore the X / TikTok composers
 * and comment lists) choose a *paragraph base direction* with the Unicode
 * "first strong character" heuristic (TextDirectionHeuristics.FIRSTSTRONG_LTR,
 * the platform default). When an Arabic comment happens to start with a strong
 * LTR token — most often a leading `@mention`, or a Latin brand/tech term
 * ("MicroStrategy", "Red Lines", "AI"…) — the WHOLE paragraph is laid out
 * left-to-right and left-aligned. The glyphs stay correct ("bon arabe") but the
 * block is no longer right-to-left. Measured live: ~19% of our X Arabic replies
 * hit this, vs almost no TikTok comments (they rarely open with an @mention).
 *
 * The fix is the standard Unicode one: prepend a zero-width base-direction mark
 * so the first strong character is RTL. We use ARABIC LETTER MARK (U+061C, ALM)
 * for Arabic-script content — the mark Unicode recommends for Arabic, and one
 * that mention parsers treat as a word boundary — and RIGHT-TO-LEFT MARK
 * (U+200F, RLM) for other RTL scripts (Hebrew, …).
 *
 * The mark is only added when it is actually needed (RTL content whose first
 * strong char is LTR), so pure-Arabic text and any non-RTL text are returned
 * byte-for-byte unchanged.
 */

/** ARABIC LETTER MARK — zero-width, non-printing; preferred for Arabic script. */
const ALM = "\u061C";
/** RIGHT-TO-LEFT MARK — zero-width, non-printing; used for other RTL scripts. */
const RLM = "\u200F";

// Strong RTL letters that force an RTL run. Arabic (base, Supplement,
// Extended-A) plus Arabic presentation forms A/B.
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
// Other RTL scripts: Hebrew (+ presentation forms), Syriac, Thaana, NKo.
const OTHER_RTL_RE = /[\u0590-\u05FF\uFB1D-\uFB4F\u0700-\u074F\u0780-\u07BF\u07C0-\u07FF]/;
// Any strong RTL letter (either family above).
const RTL_RE = new RegExp(`${ARABIC_RE.source}|${OTHER_RTL_RE.source}`);
// Strong LTR letters: Latin (+ extended), Greek, Cyrillic cover every case the
// writer emits. Digits/punctuation/`@`/`#`/emoji are neutral and skipped.
const STRONG_LTR_RE = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

// Zero-width bidi/format control characters (ALM, LRM, RLM, embeddings,
// overrides, isolates). Stripped for direction-agnostic text comparison.
const BIDI_MARK_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** Whether the text contains any strong right-to-left character. */
function hasRtlChars(text: string): boolean {
  return RTL_RE.test(text);
}

/**
 * Direction of the first *strong* directional character, scanning past neutral
 * characters (spaces, digits, punctuation, `@`, `#`, emoji). Returns `null`
 * when the text has no strong character at all.
 */
function firstStrongDirection(text: string): "rtl" | "ltr" | null {
  for (const ch of text) {
    if (RTL_RE.test(ch)) return "rtl";
    if (STRONG_LTR_RE.test(ch)) return "ltr";
  }
  return null;
}

/** Remove zero-width bidi/format marks so comparisons are direction-agnostic. */
export function stripBidiMarks(text: string): string {
  return text.replace(BIDI_MARK_RE, "");
}

/**
 * Whether the publish path will prepend a base-direction mark to this text:
 * it contains RTL script AND its first strong character is LTR (the exact
 * pattern that renders left-to-right on the target apps). Exposed so the
 * generation side can reserve one character of the platform cap for the mark.
 */
export function needsRtlBaseDirection(text: string): boolean {
  if (!text) return false;
  if (text.startsWith(ALM) || text.startsWith(RLM)) return false;
  return hasRtlChars(text) && firstStrongDirection(text) !== "rtl";
}

/**
 * Guarantee an RTL paragraph base direction for RTL-script content.
 *
 * Returns `text` unchanged unless `needsRtlBaseDirection(text)`, in which case
 * it prepends the script-appropriate base-direction mark (ALM for Arabic, RLM
 * otherwise). Idempotent: text already led by a mark, or whose first strong
 * char is already RTL, is returned untouched.
 */
export function ensureRtlBaseDirection(text: string): string {
  if (!needsRtlBaseDirection(text)) return text;
  return (ARABIC_RE.test(text) ? ALM : RLM) + text;
}
