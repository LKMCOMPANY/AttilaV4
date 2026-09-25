/**
 * The one arbiter of container slots per box, shared by the campaign
 * executor, the maintenance runner and the operator start route.
 *
 * Why it exists (measured 9 September 2026): the VMOS API accepts an 11th
 * container, boots under contention take 35–90 s instead of 10–17 s, and the
 * database's `devices.state` drifts from the box (a container ran for eight
 * days while the database said stopped). So the arbiter counts what the box
 * reports live — `running` and `starting` both occupy a slot — keeps the
 * operator reserve free, lets campaign jobs pre-empt maintenance, and bounds
 * how many containers a single box is asked to start at once.
 *
 * Added 25 September 2026, after box-1 came back from a move with eight
 * containers booting at once (load average 192, zram at 100 %):
 *   - `box_unhealthy`   — the host is above the CPU / memory / swap thresholds
 *                         of `runtime_settings.boxes.health_thresholds`;
 *   - `box_settling`    — the box (re)started less than `settling_seconds` ago
 *                         and already has more than `settling_max_starting`
 *                         containers booting: let the boot storm pass;
 *   - `box_maintenance` — an operator opened `boxes.maintenance_until`.
 * The decision (`decideSlot`) is pure and tested; this module only feeds it.
 */

import { fetchContainerList, fetchHealthz, fetchSystemInfo } from "@/lib/box-api";
import { assessHostHealth, loadHealthThresholds, type HealthThresholds } from "@/lib/boxes/host-health";
import { isUnderMaintenance } from "@/lib/boxes/presence";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { BoxHostHealth } from "@/types";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface BoxRow {
  id: string;
  tunnel_hostname: string;
  max_concurrent_containers: number | null;
  operator_reserve: number | null;
  maintenance_until?: string | null;
  host_health?: BoxHostHealth | null;
}

/** Columns the arbiter needs from `boxes`. */
export const BOX_SLOT_COLUMNS = "id, tunnel_hostname, max_concurrent_containers, operator_reserve, maintenance_until, host_health";

export type SlotPurpose = "campaign" | "maintenance" | "operator";

export const SLOT_REFUSALS = [
  "box_unreachable",
  "box_full",
  "operator_reserve",
  "campaign_priority",
  "starts_in_flight",
  "box_maintenance",
  "box_unhealthy",
  "box_settling",
] as const;
export type SlotRefusal = (typeof SLOT_REFUSALS)[number];

/**
 * The refusals the operator start route answers as `{ refused }`: closing a
 * device would not help, so the cockpits name the reason and revert. A plainly
 * full box (`box_full`) keeps its own flow — auto-close an idle device, else
 * `atCapacity` with the victims list; `operator_reserve` and
 * `campaign_priority` never apply to an operator.
 */
export const OPERATOR_HARD_REFUSALS: readonly SlotRefusal[] = [
  "box_maintenance",
  "box_unhealthy",
  "box_settling",
  "box_unreachable",
  "starts_in_flight",
];

export interface LiveOccupancy {
  running: number;
  starting: number;
  /** db_ids the box reports as running or starting. */
  occupied: string[];
  /** Seconds since the box's proxy came up — a box that just (re)booted is young. */
  uptimeSeconds: number | null;
  /** Live host sample, when `/v1/systeminfo` answered. */
  host: Pick<BoxHostHealth, "cpu_percent" | "mem_percent" | "swap_percent"> | null;
}

export interface SlotDecision {
  granted: boolean;
  reason: "ok" | "already_running" | SlotRefusal;
  live: LiveOccupancy | null;
  /** Containers the automation may hold on this box after the operator reserve. */
  automationCapacity: number;
  /** For `box_unhealthy`: which threshold tripped, e.g. `swap_percent 74 > 60`. */
  detail?: string;
}

/** The one default the whole codebase uses when `boxes.max_concurrent_containers` is null. */
export const DEFAULT_MAX_CONCURRENT = 10;
const DEFAULT_OPERATOR_RESERVE = 1;
/** Serial boots: at most this many `run` calls in flight per box (35–90 s boots beyond). */
const MAX_STARTS_IN_FLIGHT = 2;
const LIVE_CACHE_MS = 5_000;

const liveCache = new Map<string, { at: number; occupancy: LiveOccupancy }>();
const startsInFlight = new Map<string, number>();

/** What the box reports right now (cached 5 s so a burst of claims reads once). */
async function readLiveOccupancy(tunnelHostname: string): Promise<LiveOccupancy | null> {
  const cached = liveCache.get(tunnelHostname);
  if (cached && Date.now() - cached.at < LIVE_CACHE_MS) return cached.occupancy;
  try {
    const [{ list }, health, system] = await Promise.all([
      fetchContainerList(tunnelHostname),
      fetchHealthz(tunnelHostname).catch(() => null),
      fetchSystemInfo(tunnelHostname).catch(() => null),
    ]);
    const occupancy: LiveOccupancy = {
      running: 0,
      starting: 0,
      occupied: [],
      uptimeSeconds: health?.uptime ?? null,
      host: system ? { cpu_percent: system.cpu ?? null, mem_percent: system.mem_percent ?? null, swap_percent: system.swap_percent ?? null } : null,
    };
    for (const c of list) {
      const state = String(c.state);
      if (state === "running") occupancy.running++;
      else if (state === "starting") occupancy.starting++;
      else continue;
      occupancy.occupied.push(c.db_id);
    }
    liveCache.set(tunnelHostname, { at: Date.now(), occupancy });
    return occupancy;
  } catch {
    return null;
  }
}

/** Forget the cached count after a start/stop we issued ourselves. */
function invalidateLiveOccupancy(tunnelHostname: string): void {
  liveCache.delete(tunnelHostname);
}

export interface SlotInput {
  box: BoxRow;
  dbId: string;
  purpose: SlotPurpose;
  live: LiveOccupancy | null;
  /** Is there a due `ready` or an `executing` campaign job on this box? */
  campaignDue: boolean;
  startsInFlight: number;
  thresholds: HealthThresholds;
  now?: Date;
}

/**
 * The decision, pure. Order matters: a container already up is always
 * granted (nothing to start), a maintenance window beats everything else,
 * then the hard host guards, then capacity, then priority and boot pacing.
 */
export function decideSlot(input: SlotInput): SlotDecision {
  const { box, dbId, purpose, live, thresholds } = input;
  const max = box.max_concurrent_containers ?? DEFAULT_MAX_CONCURRENT;
  const reserve = box.operator_reserve ?? DEFAULT_OPERATOR_RESERVE;
  const automationCapacity = Math.max(0, max - reserve);
  const refuse = (reason: SlotRefusal, detail?: string): SlotDecision => ({ granted: false, reason, live, automationCapacity, detail });

  if (!live) return refuse("box_unreachable");
  if (live.occupied.includes(dbId)) return { granted: true, reason: "already_running", live, automationCapacity };

  if (isUnderMaintenance({ maintenance_until: box.maintenance_until ?? null }, input.now)) {
    return refuse("box_maintenance", box.maintenance_until ?? undefined);
  }

  const health = assessHostHealth(live.host ?? box.host_health ?? null, thresholds);
  if (health.verdict === "unhealthy") return refuse("box_unhealthy", health.over.join(", "));
  if (live.uptimeSeconds != null && live.uptimeSeconds < thresholds.settling_seconds && live.starting > thresholds.settling_max_starting) {
    return refuse("box_settling", `up ${Math.round(live.uptimeSeconds)} s, ${live.starting} starting`);
  }

  const occupied = live.running + live.starting;
  if (occupied >= max) return refuse("box_full");
  // Operators use the reserve; automation stops one slot short of it.
  if (purpose !== "operator" && occupied + 1 > automationCapacity) return refuse("operator_reserve");

  if (purpose === "maintenance" && input.campaignDue) return refuse("campaign_priority");
  if (input.startsInFlight >= MAX_STARTS_IN_FLIGHT) return refuse("starts_in_flight");
  return { granted: true, reason: "ok", live, automationCapacity };
}

/**
 * May `purpose` start container `dbId` on this box now? Never starts anything
 * itself; the caller proceeds only on `granted` and, for a cold start, wraps
 * the boot in `withStartSlot`.
 */
export async function assessBoxSlot(
  supabase: AdminClient,
  box: BoxRow,
  dbId: string,
  purpose: SlotPurpose,
): Promise<SlotDecision> {
  const [live, thresholds] = await Promise.all([readLiveOccupancy(box.tunnel_hostname), loadHealthThresholds(supabase)]);
  const campaignDue = purpose === "maintenance" && live != null ? await hasDueCampaignWork(supabase, box.id) : false;
  return decideSlot({
    box,
    dbId,
    purpose,
    live,
    campaignDue,
    startsInFlight: startsInFlight.get(box.id) ?? 0,
    thresholds,
  });
}

/** Maintenance yields to campaigns: a ready-and-due or executing job on the box wins. */
async function hasDueCampaignWork(supabase: AdminClient, boxId: string): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const { count } = await supabase
    .from("campaign_jobs")
    .select("*", { count: "exact", head: true })
    .eq("box_id", boxId)
    .or(`status.eq.executing,and(status.eq.ready,scheduled_at.lte.${nowIso})`);
  return (count ?? 0) > 0;
}

/**
 * Bound concurrent cold starts per box while `boot` runs (a `run` followed by
 * the wait for Android). Throws `StartSlotBusyError` instead of queueing so
 * the caller can pick another box or come back later.
 */
export async function withStartSlot<T>(box: BoxRow, boot: () => Promise<T>): Promise<T> {
  const inFlight = startsInFlight.get(box.id) ?? 0;
  if (inFlight >= MAX_STARTS_IN_FLIGHT) throw new StartSlotBusyError(box.tunnel_hostname, inFlight);
  startsInFlight.set(box.id, inFlight + 1);
  try {
    return await boot();
  } finally {
    startsInFlight.set(box.id, Math.max(0, (startsInFlight.get(box.id) ?? 1) - 1));
    invalidateLiveOccupancy(box.tunnel_hostname);
  }
}

export class StartSlotBusyError extends Error {
  constructor(tunnelHostname: string, inFlight: number) {
    super(`${tunnelHostname} already has ${inFlight} container start(s) in flight`);
    this.name = "StartSlotBusyError";
  }
}
