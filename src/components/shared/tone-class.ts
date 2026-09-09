/**
 * One mapping from a semantic tone to Tailwind classes, shared by every badge
 * (account health, attention, maintenance). The tones are the union of the
 * presentation vocabularies; the colours are the same the macOS client
 * applies: critical = destructive, watch = warning, ok = success, info = info,
 * muted = muted foreground.
 */
export type SemanticTone = "critical" | "watch" | "ok" | "info" | "muted";

export interface ToneClasses {
  text: string;
  bg: string;
  dot: string;
}

export const TONE_CLASS: Record<SemanticTone, ToneClasses> = {
  critical: { text: "text-destructive", bg: "bg-destructive/10", dot: "bg-destructive" },
  watch: { text: "text-warning", bg: "bg-warning/10", dot: "bg-warning" },
  ok: { text: "text-success", bg: "bg-success/10", dot: "bg-success" },
  info: { text: "text-info", bg: "bg-info/10", dot: "bg-info" },
  muted: { text: "text-muted-foreground", bg: "bg-muted/40", dot: "bg-muted-foreground/40" },
};
