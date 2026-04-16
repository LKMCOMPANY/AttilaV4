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

// ---------------------------------------------------------------------------
// Container lifecycle (used by pipeline execute)
// ---------------------------------------------------------------------------

const CONTAINER_START_POLL_MS = 2000;
const CONTAINER_START_TIMEOUT_MS = 30_000;

/**
 * Ensure a container is running. If stopped, start it and poll until ready.
 * Returns true if running, false if start timed out.
 */
export async function ensureContainerRunning(
  tunnelHostname: string,
  dbId: string,
): Promise<{ running: boolean; wasStarted: boolean }> {
  const detail = await fetchContainerDetail(tunnelHostname, dbId);

  if (detail?.status === "running") {
    console.log(`[Container] ${dbId} already running`);
    return { running: true, wasStarted: false };
  }

  console.log(`[Container] ${dbId} is ${detail?.status ?? "unknown"} — starting`);
  await boxFetch(tunnelHostname, "/container_api/v1/run", {
    method: "POST",
    body: JSON.stringify({ db_ids: [dbId] }),
  });

  const deadline = Date.now() + CONTAINER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, CONTAINER_START_POLL_MS));
    const check = await fetchContainerDetail(tunnelHostname, dbId);
    if (check?.status === "running") {
      console.log(`[Container] ${dbId} started OK`);
      return { running: true, wasStarted: true };
    }
  }

  console.error(`[Container] ${dbId} start timeout after ${CONTAINER_START_TIMEOUT_MS}ms`);
  return { running: false, wasStarted: true };
}

/**
 * Stop a container if no other ready jobs target this device.
 */
export async function stopContainerIfIdle(
  tunnelHostname: string,
  dbId: string,
  deviceId: string,
  supabase: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>,
): Promise<void> {
  const { count } = await supabase
    .from("campaign_jobs")
    .select("*", { count: "exact", head: true })
    .eq("device_id", deviceId)
    .in("status", ["ready", "executing"]);

  if (count && count > 0) {
    console.log(`[Container] ${dbId} kept running — ${count} pending jobs on this device`);
    return;
  }

  console.log(`[Container] ${dbId} stopping — no pending jobs`);
  try {
    await boxFetch(tunnelHostname, "/container_api/v1/stop", {
      method: "POST",
      body: JSON.stringify({ db_ids: [dbId] }),
    });
  } catch (err) {
    console.error(`[Container] ${dbId} stop failed:`, err instanceof Error ? err.message : err);
  }
}

export { boxFetch, getCfHeaders };
