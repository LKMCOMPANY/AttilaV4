/**
 * Container API v1 reads: box health, container inventory, per-container
 * hardware/software detail, timezone and locale.
 */

import { boxFetch } from "./fetch";
import type {
  ProxyHealthz,
  VmosContainer,
  VmosContainerDetail,
  VmosHardwareCfg,
  VmosNetInfo,
  VmosResponse,
  VmosSystemInfo,
  VmosTimezoneLocale,
} from "./types";

export async function fetchHealthz(tunnelHostname: string) {
  return boxFetch<ProxyHealthz>(tunnelHostname, "/healthz");
}

/** Host identity and firmware — the one endpoint that answers on every CBS line. */
export async function fetchHardwareCfg(tunnelHostname: string) {
  const res = await boxFetch<VmosResponse<VmosHardwareCfg>>(tunnelHostname, "/v1/get_hardware_cfg", {
    timeoutMs: 10_000,
  });
  return res.code === 200 ? res.data : null;
}

/** Host load, memory, swap and disks. */
export async function fetchSystemInfo(tunnelHostname: string) {
  const res = await boxFetch<VmosResponse<VmosSystemInfo>>(tunnelHostname, "/v1/systeminfo", {
    timeoutMs: 10_000,
  });
  return res.code === 200 ? res.data : null;
}

/** The box's own view of its LAN address — the only legitimate source of `boxes.lan_ip`. */
export async function fetchNetInfo(tunnelHostname: string) {
  const res = await boxFetch<VmosResponse<VmosNetInfo>>(tunnelHostname, "/v1/net_info", {
    timeoutMs: 10_000,
  });
  return res.code === 200 ? res.data : null;
}

export async function fetchContainerList(tunnelHostname: string) {
  const res = await boxFetch<VmosResponse<{ host_ip: string; list: VmosContainer[] }>>(
    tunnelHostname,
    "/container_api/v1/list_names",
  );
  return res.data;
}

/**
 * Best-effort Android major version for a device.
 *
 * `get_android_detail.aosp_version` is unreliable — it is frequently absent,
 * `"initializing"`, or empty right after boot, which is why so many device rows
 * store `null`/`"initializing"` despite running an Android-13 image. The image
 * name always encodes the version (`vcloud_android13_edge_…`), so we derive from
 * it when the reported value isn't a clean number. Returns null when neither
 * source yields a version (so callers can skip the write rather than store junk).
 */
export function aospFromDetail(
  detail: Pick<VmosContainerDetail, "aosp_version" | "image">,
): string | null {
  const reported = (detail.aosp_version ?? "").trim();
  if (/^\d+$/.test(reported)) return reported;
  const fromImage = (detail.image ?? "").match(/android(\d+)/i);
  return fromImage ? fromImage[1] : null;
}

export async function fetchContainerDetail(tunnelHostname: string, dbId: string) {
  const res = await boxFetch<VmosResponse<VmosContainerDetail>>(
    tunnelHostname,
    `/container_api/v1/get_android_detail/${dbId}`,
  );
  // code 200 = running, code 201 = stopped (still has hardware data)
  if (res.code !== 200 && res.code !== 201) return null;
  return res.data;
}

export async function fetchTimezoneLocale(tunnelHostname: string, dbId: string) {
  const res = await boxFetch<VmosResponse<VmosTimezoneLocale>>(
    tunnelHostname,
    `/android_api/v1/get_timezone_locale/${dbId}`,
  );
  if (res.code !== 200) return null;
  return res.data;
}
