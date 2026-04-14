/**
 * Server-side helper to call box VMOS APIs via Cloudflare Tunnel.
 * All requests include CF-Access headers for authentication.
 */

function getCfHeaders() {
  return {
    "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID!,
    "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET!,
  };
}

// ---------------------------------------------------------------------------
// Low-level fetch
// ---------------------------------------------------------------------------

async function boxFetch<T>(
  tunnelHostname: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = `https://${tunnelHostname}${path}`;
  const headers = new Headers(init?.headers);
  Object.entries(getCfHeaders()).forEach(([k, v]) => headers.set(k, v));
  if (!headers.has("content-type") && init?.method === "POST") {
    headers.set("content-type", "application/json");
  }

  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Box API error: ${res.status} ${res.statusText} — ${url}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Response types (from VMOS API)
// ---------------------------------------------------------------------------

export interface VmosContainer {
  adb: number;
  db_id: string;
  name: string;
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

interface VmosResponse<T> {
  code: number;
  data: T;
  msg: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchHealthz(tunnelHostname: string) {
  return boxFetch<{ status: string; uptime: number; containers: number }>(
    tunnelHostname,
    "/healthz"
  );
}

export async function fetchContainerList(tunnelHostname: string) {
  const res = await boxFetch<
    VmosResponse<{ host_ip: string; list: VmosContainer[] }>
  >(tunnelHostname, "/container_api/v1/list_names");
  return res.data;
}

export async function fetchContainerDetail(
  tunnelHostname: string,
  dbId: string
) {
  const res = await boxFetch<VmosResponse<VmosContainerDetail>>(
    tunnelHostname,
    `/container_api/v1/get_android_detail/${dbId}`
  );
  // code 200 = running, code 201 = stopped (still has hardware data)
  if (res.code !== 200 && res.code !== 201) return null;
  return res.data;
}

export async function fetchTimezoneLocale(
  tunnelHostname: string,
  dbId: string
) {
  const res = await boxFetch<VmosResponse<VmosTimezoneLocale>>(
    tunnelHostname,
    `/android_api/v1/get_timezone_locale/${dbId}`
  );
  if (res.code !== 200) return null;
  return res.data;
}

export async function fetchProxyConfig(
  tunnelHostname: string,
  dbId: string
) {
  const res = await boxFetch<
    VmosResponse<{ proxy_config: VmosProxyConfig; [key: string]: unknown }>
  >(tunnelHostname, `/android_api/v1/proxy_get/${dbId}`);
  if (res.code !== 200) return null;
  return res.data.proxy_config;
}

export { boxFetch, getCfHeaders };
