/**
 * The ONE writer of a box's presence: `boxes.status`, `lan_ip`,
 * `uptime_seconds`, `container_count`, `last_heartbeat`, `host_health` and the
 * firmware facts (`model`, `cbs_version`, `kernel_version`, `default_image`,
 * `firmware_checked_at`).
 *
 * Until 25 September 2026 three code paths wrote `boxes.status` with three
 * different rules (the reconcile worker, `syncBoxCore`, the reaper's
 * `markBoxOffline`), and none of them ever marked a device `removed`. box-4
 * read `offline` for four days while its tunnel answered. Every path now goes
 * through `observeBox` / `markBoxUnreachable`, and the decision itself
 * (`decidePresence`) is a pure function with tests.
 *
 * `lan_ip` is OBSERVED (`/v1/net_info` → `host_ip`, else the proxy's `lan_ip`,
 * else `list_names.host_ip`) — never typed: the boxes are on DHCP.
 */

import {
  fetchContainerDetail,
  fetchContainerList,
  fetchHardwareCfg,
  fetchHealthz,
  fetchNetInfo,
  fetchSystemInfo,
  type ProxyHealthz,
  type VmosContainer,
  type VmosHardwareCfg,
  type VmosNetInfo,
  type VmosSystemInfo,
} from "@/lib/box-api";
import { assessHostHealth, DEFAULT_HEALTH_THRESHOLDS, loadHealthThresholds, type HealthThresholds } from "@/lib/boxes/host-health";
import { isMaintenanceOpen } from "@/lib/boxes/maintenance-window";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { BoxHostHealth, BoxStatus } from "@/types";

type AdminClient = ReturnType<typeof createAdminClient>;

/** The columns the presence writer reads before deciding. */
export interface BoxPresenceRow {
  id: string;
  tunnel_hostname: string;
  status: BoxStatus;
  maintenance_until: string | null;
  firmware_checked_at: string | null;
}

/** What one round of probes saw. `health` null ⇒ the box did not answer. */
export interface BoxObservation {
  health: ProxyHealthz | null;
  containers: { host_ip?: string; list: VmosContainer[] } | null;
  hardware?: VmosHardwareCfg | null;
  system?: VmosSystemInfo | null;
  net?: VmosNetInfo | null;
  /** Repository name (no tag) of the first container's image, when read. */
  image?: string | null;
}

export type PresenceTransition = "online" | "offline" | "unchanged" | "held_maintenance";

export interface PresenceDecision {
  transition: PresenceTransition;
  /** Columns to write on `boxes` — empty when nothing must change. */
  patch: Record<string, unknown>;
}

/** Re-read firmware facts at most this often (they change on an upgrade only). */
const FIRMWARE_REFRESH_MS = 60 * 60 * 1000;

/** Row-shaped reading of the shared window rule (`maintenance-window.ts`). */
export function isUnderMaintenance(row: Pick<BoxPresenceRow, "maintenance_until">, now = new Date()): boolean {
  return isMaintenanceOpen(row.maintenance_until, now);
}

/** Strip the docker tag: `repo:latest` → `repo`. */
export function stripImageTag(image: string | null | undefined): string | null {
  return image ? String(image).split(":")[0] : null;
}

function hostHealth(obs: BoxObservation, now: Date, thresholds: HealthThresholds): BoxHostHealth | null {
  const sys = obs.system;
  if (!sys && !obs.containers) return null;
  const list = obs.containers?.list ?? [];
  const sample = { cpu_percent: sys?.cpu ?? null, mem_percent: sys?.mem_percent ?? null, swap_percent: sys?.swap_percent ?? null };
  const { verdict, over } = assessHostHealth(sample, thresholds);
  return {
    verdict,
    over,
    cpu_percent: sys?.cpu ?? null,
    mem_percent: sys?.mem_percent ?? null,
    swap_percent: sys?.swap_percent ?? null,
    mmc_percent: sys?.mmc_percent ?? null,
    ssd_percent: sys?.ssd_percent ?? null,
    running: list.filter((c) => String(c.state) === "running").length,
    starting: list.filter((c) => String(c.state) === "starting").length,
    sampled_at: now.toISOString(),
  };
}

/**
 * Decide what to write from what was observed. Pure.
 *
 *   - the box answered  → `online`, fresh heartbeat, observed lan_ip, host
 *     sample, firmware facts when they were read — whatever the maintenance
 *     window says: a box that answers is online, the window is a gate the
 *     slot arbiter applies, not a status (box-5 came back under an open
 *     window on 26 September 2026 and read `offline` while it answered);
 *   - the box did not   → `offline` — unless a maintenance window is open, in
 *     which case the status is left alone (a firmware flash reboots the host
 *     and must not read as an outage).
 */
export function decidePresence(
  row: BoxPresenceRow,
  obs: BoxObservation,
  now = new Date(),
  thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
): PresenceDecision {
  const underMaintenance = isUnderMaintenance(row, now);

  if (!obs.health) {
    if (underMaintenance) return { transition: "held_maintenance", patch: {} };
    return row.status === "offline"
      ? { transition: "unchanged", patch: {} }
      : { transition: "offline", patch: { status: "offline" } };
  }

  const patch: Record<string, unknown> = {
    status: "online",
    uptime_seconds: obs.health.uptime ?? null,
    container_count: obs.containers?.list.length ?? obs.health.containers ?? 0,
    last_heartbeat: now.toISOString(),
  };

  const lanIp = obs.net?.host_ip ?? obs.health.lan_ip ?? obs.containers?.host_ip ?? null;
  if (lanIp) patch.lan_ip = lanIp;

  const health = hostHealth(obs, now, thresholds);
  if (health) patch.host_health = health;

  if (obs.hardware) {
    patch.model = obs.hardware.model ?? null;
    patch.cbs_version = obs.hardware.version || obs.system?.cbs_version || null;
    patch.kernel_version = obs.hardware.kernel_version || obs.system?.kernel_version || null;
    patch.firmware_checked_at = now.toISOString();
  }
  if (obs.image !== undefined) patch.default_image = obs.image;

  return { transition: row.status === "online" ? "unchanged" : "online", patch };
}

/** Is it time to read the (slow-changing) firmware facts again? */
export function firmwareDue(row: Pick<BoxPresenceRow, "firmware_checked_at">, now = new Date()): boolean {
  if (!row.firmware_checked_at) return true;
  return now.getTime() - new Date(row.firmware_checked_at).getTime() > FIRMWARE_REFRESH_MS;
}

/**
 * Probe a box (proxy `/healthz` + `list_names`, and the host facts when due)
 * and persist the decision. Returns the observation so callers can reconcile
 * the devices from the same `list_names` the presence was decided on.
 */
export async function observeBox(
  supabase: AdminClient,
  row: BoxPresenceRow,
  options: { now?: Date; withFirmware?: boolean } = {},
): Promise<{ decision: PresenceDecision; observation: BoxObservation }> {
  const now = options.now ?? new Date();
  const host = row.tunnel_hostname;
  // Presence is the proxy answering `/healthz`; the container list is a
  // separate fact. A box whose `list_names` fails or comes back malformed is
  // still online — its inventory is simply not reconciled on this pass.
  const [health, containers] = await Promise.all([
    fetchHealthz(host).catch(() => null),
    fetchContainerList(host).catch(() => null),
  ]);
  const obs: BoxObservation = { health, containers: health ? containers : null };

  if (obs.health) {
    const readFirmware = options.withFirmware ?? firmwareDue(row, now);
    const [system, net, hardware, image] = await Promise.all([
      fetchSystemInfo(host).catch(() => null),
      fetchNetInfo(host).catch(() => null),
      readFirmware ? fetchHardwareCfg(host).catch(() => null) : Promise.resolve(undefined),
      readFirmware ? representativeImage(host, obs.containers?.list ?? []) : Promise.resolve(undefined),
    ]);
    obs.system = system;
    obs.net = net;
    if (hardware !== undefined) obs.hardware = hardware;
    if (image !== undefined) obs.image = image;
  }

  const thresholds = await loadHealthThresholds(supabase).catch(() => DEFAULT_HEALTH_THRESHOLDS);
  const decision = decidePresence(row, obs, now, thresholds);
  if (Object.keys(decision.patch).length > 0) {
    await supabase.from("boxes").update(decision.patch).eq("id", row.id);
  }
  return { decision, observation: obs };
}

/** The image of the first container — one detail call, the box's representative image. */
async function representativeImage(host: string, list: VmosContainer[]): Promise<string | null> {
  const first = list[0]?.db_id;
  if (!first) return null;
  const detail = await fetchContainerDetail(host, first).catch(() => null);
  return stripImageTag(detail?.image ?? null);
}

/**
 * A worker met a transport-level failure on the box (tunnel 5xx, timeout):
 * the same `offline` rule as an empty observation, through the same writer.
 * Devices are NOT touched here — the reconcile worker corrects `devices.state`
 * from `list_names`, which is the only source that can.
 */
export async function markBoxUnreachable(supabase: AdminClient, row: BoxPresenceRow, now = new Date()): Promise<PresenceTransition> {
  const decision = decidePresence(row, { health: null, containers: null }, now);
  if (Object.keys(decision.patch).length > 0) {
    await supabase.from("boxes").update(decision.patch).eq("id", row.id);
  }
  return decision.transition;
}

export const BOX_PRESENCE_COLUMNS = "id, tunnel_hostname, status, maintenance_until, firmware_checked_at";
