/**
 * Wire types of the VMOS Container API (v1) and Android API (v1), as observed
 * on the fleet. The Control API v2 has its own envelope in `control-v2.ts`.
 */

export interface VmosContainer {
  adb: number;
  db_id: string;
  name: string;
  // Observed on the fleet: also "starting" (boot in progress, unstoppable) and
  // "stopping". Kept as the historical union; the slot arbiter compares raw
  // strings so it can count a `starting` container as an occupied slot.
  state: "running" | "stopped" | "creating";
  tcp_audio_port: number;
  tcp_control_port: number;
  tcp_port: number;
  user_name: string;
}

export interface VmosContainerDetail {
  adb_port: number;
  aosp_version: string;
  cpuset: string;
  dns: string;
  dpi: string;
  fps: string;
  height: string;
  id: string;
  image: string;
  ip: string;
  mac: string;
  memory: number;
  name: string;
  network: string;
  remark: string;
  short_id: string;
  status: string;
  user_name: string;
  width: string;
}

export interface VmosTimezoneLocale {
  country: string;
  locale: string;
  timezone: string;
  user_name: string;
  db_id?: string;
}

export interface VmosProxyConfig {
  enabled: boolean;
  proxyType: string;
  ip: string;
  port: number;
  account: string;
  password: string;
  dnsServers?: string[];
  proxyMode?: string;
}

/** Generic v1 envelope: `code` 200 on success, a Chinese `msg` on most failures. */
export interface VmosResponse<T> {
  code: number;
  data: T;
  msg: string;
}

export interface VmosShellData {
  cmd?: string; // present only when VMOS forwarded the command to Android
  db_id?: string;
  host_ip: string;
  message?: string; // command stdout, OR the Android exception text on cmd failure
}
