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

/**
 * `GET /v1/get_hardware_cfg` — answers on every CBS line and is the only
 * reliable source of `version` (CBS) and `kernel_version`; `/v1/systeminfo`
 * leaves both blank on 1.1.4.x. `device_id` + `hwaddr` are the box's identity
 * (manifest.tsv); `ip` is the current DHCP lease.
 */
export interface VmosHardwareCfg {
  device_id: string;
  hwaddr: string;
  ip: string;
  model: string;
  version: string;
  kernel_version?: string;
  cpuload?: string;
  cputemp?: number;
  mem_total?: string;
  mem_use?: string;
  mmc_total?: string;
  mmc_use?: string;
  ssd_total?: string;
  ssd_use?: string;
}

/** `GET /v1/systeminfo` — percentages 0–100; cbs/kernel only on 1.1.6.x. */
export interface VmosSystemInfo {
  cpu?: number;
  mem_percent?: number;
  mem_total?: number;
  swap_percent?: number;
  swap_total?: number;
  mmc_percent?: number;
  mmc_total?: number;
  ssd_percent?: number;
  ssd_total?: number;
  temperatures?: number;
  cbs_version?: string;
  kernel_version?: string;
}

/** `GET /v1/net_info` — the box's own view of its address. */
export interface VmosNetInfo {
  host_ip: string;
  gateway?: string;
  netmask?: string;
  subnet?: string;
}

/**
 * `GET /healthz` on magicbox-proxy. 1.x fields plus the 1.3.0 additive ones
 * (`api_host`, `api_iface`, `api_source`, `lan_ip`), all optional so a box
 * not yet redeployed still decodes. Contract: infra/magicbox-proxy/test/fixtures/healthz.json.
 */
export interface ProxyHealthz {
  status: "ok" | "degraded" | string;
  version?: string;
  uptime: number;
  containers?: number;
  error?: string;
  api_host?: string | null;
  api_iface?: string | null;
  api_source?: "default_route" | "iface" | "override" | "no_default_route" | string;
  lan_ip?: string | null;
}

export interface VmosShellData {
  cmd?: string; // present only when VMOS forwarded the command to Android
  db_id?: string;
  host_ip: string;
  message?: string; // command stdout, OR the Android exception text on cmd failure
}
