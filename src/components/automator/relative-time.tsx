import { formatDistanceToNow, format } from "date-fns";

// Single source for rendering a timestamp in the automator results UI: a
// scannable relative label ("5 minutes ago") with the exact local date-time on
// hover. Reused for the source post time and every avatar publication time so
// the two are visually consistent and never confused with the execution
// duration (which lives only in the technical job Timeline).
export function RelativeTime({
  iso,
  prefix,
  className,
}: {
  iso: string | null | undefined;
  /** Short verb that says WHICH moment this is ("posted ", "published "…). */
  prefix?: string;
  className?: string;
}) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  return (
    <span className={className} title={format(date, "d MMM yyyy, HH:mm:ss")}>
      {prefix}
      {formatDistanceToNow(date, { addSuffix: true })}
    </span>
  );
}
