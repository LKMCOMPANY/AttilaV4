/**
 * Number formatters shared across the UI.
 *
 * Two flavours:
 *   - `formatCount`  — for integer-by-nature values (followers, posts,
 *                      avatars, jobs). Renders as "123" / "1.5K" / "1.2M".
 *   - `formatRate`   — for fractional rates (per-hour, per-day, capacity
 *                      surplus). Keeps one decimal under 1k so the
 *                      operator sees "3.5/h × 1.5 = 5.3/h" instead of
 *                      misleading rounded integers ("4 × 1.5 = 5").
 *
 * Both use the same K/M abbreviations above 1k so call sites with mixed
 * scales (e.g. a metric grid) align consistently.
 */

export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function formatRate(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  // Hide the trailing decimal for whole numbers — "5/h" reads cleaner
  // than "5.0/h" while preserving the precision contract for fractions.
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

/**
 * Pretty-prints a 0..1 confidence score as a percentage.
 *   0.873 → "87%"
 *   1     → "100%"
 *   null  → "—"
 */
export function formatConfidence(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}
