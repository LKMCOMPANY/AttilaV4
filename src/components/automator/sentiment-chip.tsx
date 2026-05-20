import { cn } from "@/lib/utils";
import { formatConfidence } from "@/lib/format";
import type { SentimentLabel } from "@/types";

/**
 * Tiny inline chip surfacing the sentiment Gorgone V4 pre-computes for
 * every post (`post_ai_classifications`). Renders nothing when the
 * post has no sentiment yet — keeps the row layout calm for the
 * common case where AI hasn't landed.
 *
 * `variant="compact"` (default) is the inline list-row affordance —
 * a 1-character dot + label. `variant="detailed"` adds the confidence
 * percentage and is used in the post detail view.
 */

interface SentimentChipProps {
  label: SentimentLabel | string | null | undefined;
  score: number | null | undefined;
  variant?: "compact" | "detailed";
  className?: string;
}

const SENTIMENT_STYLES: Record<
  "positive" | "negative" | "neutral",
  { dot: string; bg: string; text: string }
> = {
  positive: {
    dot: "bg-success",
    bg: "bg-success/10",
    text: "text-success",
  },
  negative: {
    dot: "bg-destructive",
    bg: "bg-destructive/10",
    text: "text-destructive",
  },
  neutral: {
    dot: "bg-muted-foreground/60",
    bg: "bg-muted",
    text: "text-muted-foreground",
  },
};

function isKnownLabel(
  label: string | null | undefined,
): label is "positive" | "negative" | "neutral" {
  return label === "positive" || label === "negative" || label === "neutral";
}

export function SentimentChip({
  label,
  score,
  variant = "compact",
  className,
}: SentimentChipProps) {
  if (!isKnownLabel(label)) return null;
  const styles = SENTIMENT_STYLES[label];

  const ariaLabel =
    score != null
      ? `Sentiment: ${label}, confidence ${formatConfidence(score)}`
      : `Sentiment: ${label}`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide tabular-nums",
        styles.bg,
        styles.text,
        className,
      )}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <span className={cn("h-1 w-1 rounded-full", styles.dot)} aria-hidden />
      {label}
      {variant === "detailed" && score != null && (
        <span className="opacity-70">{formatConfidence(score)}</span>
      )}
    </span>
  );
}
