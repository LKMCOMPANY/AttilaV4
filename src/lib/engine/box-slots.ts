/**
 * The one arbiter of container slots per box, shared by the campaign
 * executor and the maintenance runner.
 *
 * Why it exists (measured 9 September 2026): the VMOS API accepts an 11th
 * container, boots under contention take 35–90 s instead of 10–17 s, and the
 * database's `devices.state` drifts from the box (a container ran for eight
 * days while the database said stopped). So the arbiter counts what the box
 * reports live — `running` and `starting` both occupy a slot — keeps the
 * operator reserve free, lets campaign jobs pre-empt maintenance, and bounds
 * how many containers a single box is asked to start at once.
 */

import { fetchContainerList } from "@/lib/box-api";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface BoxRow {
  id: string;
  tunnel_hostname: string;
  max_concurrent_containers: number | null;
  operator_reserve: number | null;
}

export type SlotPurpose = "campaign" | "maintenance";

export type SlotRefusal =
  | "box_unreachable"
  | "box_full"
  | "operator_reserve"
  | "campaign_priority"
  | "starts_in_flight";

export interface LiveOccupancy {
  running: number;
  starting: number;
  /** db_ids the box reports as running or starting. */
  occupied: string[];
}

export interface SlotDecision {
  granted: boolean;
  reason: "ok" | "already_running" | SlotRefusal;
  live: LiveOccupancy | null;
  /** Containers the automation may hold on this box after the operator reserve. */
  automationCapacity: number;
}

const DEFAULT_MAX_CONCURRENT = 10;
const DEFAULT_OPERATOR_RESERVE = 1;
/** Serial boots: at most this many `run` calls in flight per box (35–90 s boots beyond). */
const MAX_STARTS_IN_FLIGHT = 2;
const LIVE_CACHE_MS = 5_000;

const liveCache = new Map<string, { at: number; occupancy: LiveOccupancy }>();
const startsInFlight = new Map<string, number>();

/** What the box reports right now (cached 5 s so a burst of claims reads once). */
export async function readLiveOccupancy(tunnelHostname: string): Promise<LiveOccupancy | null> {
  const cached = liveCache.get(tunnelHostname);
  if (cached && Date.now() - cached.at < LIVE_CACHE_MS) return cached.occupancy;
  try {
    const { list } = await fetchContainerList(tunnelHostname);
    const occupancy: LiveOccupancy = { running: 0, starting: 0, occupied: [] };
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
export function invalidateLiveOccupancy(tunnelHostname: string): void {
  liveCache.delete(tunnelHostname);
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
  const max = box.max_concurrent_containers ?? DEFAULT_MAX_CONCURRENT;
  const reserve = box.operator_reserve ?? DEFAULT_OPERATOR_RESERVE;
  const automationCapacity = Math.max(0, max - reserve);

  const live = await readLiveOccupancy(box.tunnel_hostname);
  if (!live) return { granted: false, reason: "box_unreachable", live, automationCapacity };
  if (live.occupied.includes(dbId)) return { granted: true, reason: "already_running", live, automationCapacity };

  const occupied = live.running + live.starting;
  if (occupied >= max) return { granted: false, reason: "box_full", live, automationCapacity };
  if (occupied + 1 > automationCapacity) return { granted: false, reason: "operator_reserve", live, automationCapacity };

  if (purpose === "maintenance" && (await hasDueCampaignWork(supabase, box.id))) {
    return { granted: false, reason: "campaign_priority", live, automationCapacity };
  }
  if ((startsInFlight.get(box.id) ?? 0) >= MAX_STARTS_IN_FLIGHT) {
    return { granted: false, reason: "starts_in_flight", live, automationCapacity };
  }
  return { granted: true, reason: "ok", live, automationCapacity };
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
