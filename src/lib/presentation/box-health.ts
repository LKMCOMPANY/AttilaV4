import type { BoxHealthVerdict } from "@/lib/boxes/host-health";
import type { Box, BoxStatus } from "@/types";

// ---------------------------------------------------------------------------
// Boxes — presentation vocabulary shared by both clients.
//
// One label and one tone per wire value of `boxes.status` and of
// `boxes.host_health.verdict` (stamped by the presence writer with the
// arbiter's thresholds, so no client needs the thresholds). The Swift mirror
// is `BoxHealthPresentation.swift`; both are pinned to
// `__fixtures__/box-health-vocabulary.json` by a test. Framework-free.
// ---------------------------------------------------------------------------

/** Semantic tone → colour: critical = danger, watch = warning, ok = success, info = info, muted = muted. */
export type BoxTone = "critical" | "watch" | "ok" | "info" | "muted";

export interface BoxMeta {
  label: string;
  tone: BoxTone;
}

export const BOX_STATUS_META: Record<BoxStatus, BoxMeta> = {
  online: { label: "Online", tone: "ok" },
  offline: { label: "Offline", tone: "critical" },
};

export const BOX_HEALTH_VERDICT_META: Record<BoxHealthVerdict, BoxMeta> = {
  ok: { label: "Host healthy", tone: "ok" },
  unhealthy: { label: "Host overloaded", tone: "critical" },
  unknown: { label: "Host not sampled", tone: "muted" },
};

/** A box inside its `maintenance_until` window — shown in place of the status. */
export const BOX_MAINTENANCE_META: BoxMeta = { label: "Under maintenance", tone: "info" };

/** Tone of a value this build does not know — the server may add values first. */
export const UNKNOWN_BOX_VALUE_TONE: BoxTone = "muted";

function humanise(value: string, fallback: string): string {
  const words = value.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : fallback;
}

/** Presentation of a verdict; rows written before the verdict existed read as `unknown`. */
export function boxHealthVerdictMeta(verdict: string | null | undefined): BoxMeta {
  if (verdict == null) return BOX_HEALTH_VERDICT_META.unknown;
  if (verdict in BOX_HEALTH_VERDICT_META) return BOX_HEALTH_VERDICT_META[verdict as BoxHealthVerdict];
  return { label: humanise(verdict, "Unknown"), tone: UNKNOWN_BOX_VALUE_TONE };
}

/**
 * What the status dot / badge says about a box: the maintenance window wins
 * over the stored status (the presence writer holds the status during it, so
 * a rebooting host must not read as an outage), then the status itself.
 */
export function boxPresenceMeta(
  box: Pick<Box, "status" | "maintenance_until">,
  now: Date = new Date(),
): BoxMeta {
  if (box.maintenance_until && new Date(box.maintenance_until).getTime() > now.getTime()) {
    return BOX_MAINTENANCE_META;
  }
  const status: string = box.status;
  if (status in BOX_STATUS_META) return BOX_STATUS_META[status as BoxStatus];
  return { label: humanise(status, "Unknown"), tone: UNKNOWN_BOX_VALUE_TONE };
}
