/**
 * Host health of a box — one rule, two readers.
 *
 * The slot arbiter (`decideSlot`) refuses `box_unhealthy` when a live
 * `/v1/systeminfo` sample is over the thresholds; the presence writer
 * (`decidePresence`) stamps the same verdict on `boxes.host_health` so the
 * cockpits show what the arbiter would decide without knowing the thresholds.
 * Both call `assessHostHealth`; the thresholds come from
 * `runtime_settings.boxes.health_thresholds` (defaults below, cached 60 s).
 *
 * Measured 25 September 2026 on box-1 after a move: eight containers booting
 * at once, load average 192, zram at 100 %, healthy boots reading as dead.
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import type { BoxHostHealth } from "@/types";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface HealthThresholds {
  cpu_percent: number;
  mem_percent: number;
  swap_percent: number;
  settling_seconds: number;
  settling_max_starting: number;
}

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  cpu_percent: 90,
  mem_percent: 92,
  swap_percent: 60,
  settling_seconds: 600,
  settling_max_starting: 2,
};

/** Wire values of `host_health.verdict` — the presentation vocabulary keys on them. */
export const BOX_HEALTH_VERDICTS = ["ok", "unhealthy", "unknown"] as const;
export type BoxHealthVerdict = (typeof BOX_HEALTH_VERDICTS)[number];

export interface HostHealthAssessment {
  verdict: BoxHealthVerdict;
  /** Which thresholds tripped, e.g. `swap 74% > 60%` — the detail both cockpits show. */
  over: string[];
}

type HostSample = Pick<BoxHostHealth, "cpu_percent" | "mem_percent" | "swap_percent">;

/**
 * Compare one sample against the thresholds. `unknown` when there is no
 * sample or none of the three gauges was read (a box that answers
 * `/healthz` but not `/v1/systeminfo`).
 */
export function assessHostHealth(host: HostSample | null | undefined, thresholds: HealthThresholds): HostHealthAssessment {
  if (!host || (host.cpu_percent == null && host.mem_percent == null && host.swap_percent == null)) {
    return { verdict: "unknown", over: [] };
  }
  const over: string[] = [];
  if (host.cpu_percent != null && host.cpu_percent > thresholds.cpu_percent) over.push(`cpu ${host.cpu_percent}% > ${thresholds.cpu_percent}%`);
  if (host.mem_percent != null && host.mem_percent > thresholds.mem_percent) over.push(`mem ${host.mem_percent}% > ${thresholds.mem_percent}%`);
  if (host.swap_percent != null && host.swap_percent > thresholds.swap_percent) over.push(`swap ${host.swap_percent}% > ${thresholds.swap_percent}%`);
  return { verdict: over.length ? "unhealthy" : "ok", over };
}

const THRESHOLDS_CACHE_MS = 60_000;
let thresholdsCache: { at: number; value: HealthThresholds } | null = null;

/** `runtime_settings.boxes.health_thresholds`, defaults for anything missing, cached 60 s. */
export async function loadHealthThresholds(supabase: AdminClient): Promise<HealthThresholds> {
  if (thresholdsCache && Date.now() - thresholdsCache.at < THRESHOLDS_CACHE_MS) return thresholdsCache.value;
  const { data } = await supabase.from("runtime_settings").select("value").eq("key", "boxes.health_thresholds").maybeSingle();
  const raw = (data?.value ?? {}) as Partial<Record<keyof HealthThresholds, unknown>>;
  const pick = (k: keyof HealthThresholds) => (typeof raw[k] === "number" ? (raw[k] as number) : DEFAULT_HEALTH_THRESHOLDS[k]);
  const value: HealthThresholds = {
    cpu_percent: pick("cpu_percent"),
    mem_percent: pick("mem_percent"),
    swap_percent: pick("swap_percent"),
    settling_seconds: pick("settling_seconds"),
    settling_max_starting: pick("settling_max_starting"),
  };
  thresholdsCache = { at: Date.now(), value };
  return value;
}
