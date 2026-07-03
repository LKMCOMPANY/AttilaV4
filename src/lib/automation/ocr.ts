/**
 * Screenshot OCR — a confirmation signal that is independent of the Android
 * accessibility tree.
 *
 * TikTok's `uiautomator --compressed` tree intermittently omits a freshly-
 * posted comment row even though the screenshot shows it clearly. OCR of that
 * screenshot recovers the signal. Crucially it can only ever produce a false
 * NEGATIVE (a lagged/blurred frame we fail to read), never a false positive:
 * the caller only trusts an OCR hit AFTER the accessibility tree has confirmed
 * our text is no longer in the composer field, so a match can only be the
 * posted comment rendered in the list.
 *
 * `tesseract.js` is already a project dependency (also used client-side in the
 * operator panel). Here it runs server-side, best-effort: any failure returns
 * `false` so OCR never breaks a job.
 */

/** Words this short are dropped from the overlap match — they carry no signal
 * and OCR mangles them most. */
const MIN_WORD_LEN = 4;
/** Fraction of the comment's significant words that must appear in the OCR
 * text for a match. Tolerant of OCR noise, truncation and emoji loss while
 * staying specific — our comments are unique generated sentences. */
const MATCH_RATIO = 0.6;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents (OCR rarely preserves them)
    .replace(/[^a-z0-9\s]/g, " ")     // drop punctuation/emoji
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Word-overlap match: does `haystack` (OCR output) contain enough of the
 * significant words of `needle` (our comment)? Returns false for a needle with
 * too few significant words to be distinctive (avoids matching on stopwords).
 */
export function textOverlaps(haystack: string, needle: string, ratio = MATCH_RATIO): boolean {
  const hay = new Set(normalize(haystack).split(" "));
  const words = normalize(needle)
    .split(" ")
    .filter((w) => w.length >= MIN_WORD_LEN);
  if (words.length < 3) return false;
  const hits = words.filter((w) => hay.has(w)).length;
  return hits / words.length >= ratio;
}

/**
 * OCR `image` and report whether `needle` appears in it. Best-effort: returns
 * `false` on any OCR failure. `eng+fra` mirrors the operator-panel usage and
 * covers our avatar comment languages well enough for the overlap match.
 */
export async function screenshotContainsText(
  image: Buffer,
  needle: string,
): Promise<boolean> {
  if (image.length === 0) return false;
  try {
    // tesseract.js exposes `recognize` on the default export under ESM interop
    // (same shape the operator panel uses). Fall back to the namespace form.
    const mod = await import("tesseract.js");
    const recognize = mod.default?.recognize ?? mod.recognize;
    if (typeof recognize !== "function") {
      console.warn("[OCR] tesseract.js recognize() unavailable");
      return false;
    }
    const { data } = await recognize(image, "eng+fra");
    return textOverlaps(data.text ?? "", needle);
  } catch (err) {
    console.warn(`[OCR] recognize failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}
