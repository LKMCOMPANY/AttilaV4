import { cn } from "@/lib/utils";
import { TONE_CLASS, type SemanticTone } from "./tone-class";

/**
 * The one label-only pill every vocabulary badge renders: a wire value's
 * label, tinted by its semantic tone. Badges that carry an icon compose their
 * own markup; the plain ones (severity, status, task status, box presence and
 * host verdict) share this so the pill is defined once.
 */
export function TonePill({
  label,
  tone,
  title,
  className,
}: {
  label: string;
  tone: SemanticTone;
  title?: string;
  className?: string;
}) {
  const classes = TONE_CLASS[tone];
  return (
    <span title={title} className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", classes.text, classes.bg, className)}>
      {label}
    </span>
  );
}
