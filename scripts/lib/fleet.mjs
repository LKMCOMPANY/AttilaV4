/**
 * Shared fleet helpers for the standalone provisioning / audit scripts
 * (install-adbkeyboard.mjs, audit-adbkeyboard.mjs). Node ESM, zero deps.
 *
 * Importing this module loads `.env.local` and validates the required secrets,
 * then exposes one implementation of the VMOS box HTTP client, the Supabase REST
 * client, the device query, and the ADBKeyboard constants — so each script no
 * longer re-declares its own copy.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) throw new Error(`.env.local not found at ${envPath}`);
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CF_ID = process.env.CF_ACCESS_CLIENT_ID;
const CF_SECRET = process.env.CF_ACCESS_CLIENT_SECRET;

for (const [k, v] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SUPABASE_SERVICE_KEY,
  CF_ACCESS_CLIENT_ID: CF_ID,
  CF_ACCESS_CLIENT_SECRET: CF_SECRET,
})) {
  if (!v) {
    console.error(`Missing env var: ${k}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// ADBKeyboard artifacts
// ---------------------------------------------------------------------------

export const ADBKEYBOARD_PACKAGE = "com.android.adbkeyboard";
export const ADBKEYBOARD_IME = "com.android.adbkeyboard/.AdbIME";
export const ADBKEYBOARD_APK_URL =
  "https://github.com/senzhk/ADBKeyBoard/releases/download/v2.4-dev/keyboardservice-debug.apk";

// ---------------------------------------------------------------------------
// VMOS box HTTP client (via Cloudflare Access)
// ---------------------------------------------------------------------------

const cfHeaders = {
  "CF-Access-Client-Id": CF_ID,
  "CF-Access-Client-Secret": CF_SECRET,
};

export async function boxFetch(boxHost, urlPath, init = {}) {
  const url = `https://${boxHost}${urlPath}`;
  const headers = { ...cfHeaders, ...(init.headers || {}) };
  if (init.method === "POST" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} ${url} → ${text.slice(0, 200)}`);
  }
  return json;
}

/** Run an ADB shell command on a device. `ok` is true only on VMOS code 200. */
export async function shell(boxHost, dbId, cmd) {
  const json = await boxFetch(boxHost, `/android_api/v1/shell/${dbId}`, {
    method: "POST",
    body: JSON.stringify({ id: dbId, cmd }),
  });
  return {
    code: json?.code ?? -1,
    message: json?.data?.message ?? "",
    ok: (json?.code ?? -1) === 200,
  };
}

/** Set of `db_id`s currently `running` on a box. Throws if the box is unreachable. */
export async function fetchRunningDbIds(boxHost) {
  const json = await boxFetch(boxHost, "/container_api/v1/list_names");
  const list = json?.data?.list ?? [];
  return new Set(list.filter((c) => c.state === "running").map((c) => c.db_id));
}

/** VMOS ROM readiness code: 200 = ready, 1 = running but not ready, 0 = not started. */
export async function fetchRomStatus(boxHost, dbId) {
  const json = await boxFetch(boxHost, `/container_api/v1/rom_status/${dbId}`);
  return json?.code ?? -1;
}

export async function runContainer(boxHost, dbId) {
  return boxFetch(boxHost, "/container_api/v1/run", {
    method: "POST",
    body: JSON.stringify({ db_ids: [dbId] }),
  });
}

export async function stopContainer(boxHost, dbId) {
  return boxFetch(boxHost, "/container_api/v1/stop", {
    method: "POST",
    body: JSON.stringify({ db_ids: [dbId] }),
  });
}

/**
 * Recreate a container from its DB record, PRESERVING the data volume. Fixes
 * runtime anomalies (port/MAC conflict, container that won't start). Requires
 * the instance to be `stopped`/`failed`; does not auto-start (call runContainer).
 */
export async function recreateContainer(boxHost, dbId) {
  return boxFetch(boxHost, `/container_api/v1/recreate_container/${dbId}`, {
    method: "POST",
  });
}

/**
 * Real proxy connectivity test (mihomo delay) via the magicbox-proxy. Returns
 * the proxy-test contract ({ ok, delayMs } | { ok:false, error }); never throws
 * so it can be used purely as a diagnostic.
 */
export async function proxyTest(boxHost, dbId) {
  try {
    return await boxFetch(boxHost, `/proxy-test/${dbId}`);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Supabase REST (service role — bypasses RLS, scripts only)
// ---------------------------------------------------------------------------

async function supabaseFetch(pathAndQuery, init = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${pathAndQuery}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${res.status} ${url} → ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** All devices with their box + last-known ADBKeyboard state, ordered by name. */
export async function fetchDevicesWithBoxes() {
  return supabaseFetch(
    "devices?select=id,db_id,user_name,state,box_id,adbkeyboard_installed,adbkeyboard_enabled,adbkeyboard_checked_at," +
      "tiktok_installed,twitter_installed,boot_health," +
      "boxes(id,name,tunnel_hostname,max_concurrent_containers)&order=user_name.asc",
  );
}

/** All proxy-enabled devices with their box hostname + state (proxy audit). */
export async function fetchProxiedDevices() {
  return supabaseFetch(
    "devices?select=id,db_id,user_name,state,proxy_type,proxy_host,proxy_port," +
      "boxes(name,tunnel_hostname,status)&proxy_enabled=is.true&order=user_name.asc",
  );
}

/** Every device on an ONLINE box, with what the full proxy audit needs. */
export async function fetchDevicesForProxyAudit() {
  return supabaseFetch(
    "devices?select=id,db_id,user_name,state,account_id,proxy_enabled," +
      "boxes!inner(name,tunnel_hostname,status,max_concurrent_containers)" +
      "&boxes.status=eq.online&order=user_name.asc",
  );
}

/** device_ids with a ready/executing campaign job (must not be disturbed). */
export async function fetchBusyDeviceIds() {
  const rows = await supabaseFetch(
    "campaign_jobs?select=device_id&status=in.(ready,executing)",
  );
  return new Set((rows ?? []).map((r) => r.device_id).filter(Boolean));
}

/** Read the live proxy config of a RUNNING device (VMOS proxy_get). */
export async function fetchProxyConfig(boxHost, dbId) {
  const json = await boxFetch(boxHost, `/android_api/v1/proxy_get/${dbId}`);
  if ((json?.code ?? -1) !== 200) return null;
  return json?.data?.proxy_config ?? null;
}

/** Persist the observed proxy config (or clear it) for a device. */
export async function recordDeviceProxy(deviceId, proxy) {
  const body = proxy
    ? {
        proxy_enabled: !!proxy.enabled,
        proxy_type: proxy.proxyType ?? null,
        proxy_host: proxy.ip ?? null,
        proxy_port: proxy.port ?? null,
        proxy_account: proxy.account ?? null,
        proxy_password: proxy.password ?? null,
      }
    : {
        proxy_enabled: false,
        proxy_type: null,
        proxy_host: null,
        proxy_port: null,
        proxy_account: null,
        proxy_password: null,
      };
  return supabaseFetch(`devices?id=eq.${deviceId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
}

export async function updateDeviceState(deviceId, state) {
  return supabaseFetch(`devices?id=eq.${deviceId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ state, last_seen: new Date().toISOString() }),
  });
}

/** Persist the observed ADBKeyboard state (installed / enabled) + a timestamp. */
export async function recordAdbKeyboardState(deviceId, { installed, enabled }) {
  return supabaseFetch(`devices?id=eq.${deviceId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      adbkeyboard_installed: installed,
      adbkeyboard_enabled: enabled,
      adbkeyboard_checked_at: new Date().toISOString(),
    }),
  });
}

/**
 * Persist what the OFFLINE package audit saw. `adbkeyboard_enabled` is
 * deliberately untouched: VMOS clears the enabled-IME list on every container
 * restart and `activateAdbKeyboard()` re-enables it per job, so "enabled at
 * rest" carries no meaning — only the APK being present does.
 */
export async function recordPackageAudit(
  deviceId,
  { adbkeyboardInstalled, tiktokInstalled, twitterInstalled },
) {
  return supabaseFetch(`devices?id=eq.${deviceId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      adbkeyboard_installed: adbkeyboardInstalled,
      tiktok_installed: tiktokInstalled,
      twitter_installed: twitterInstalled,
      packages_checked_at: new Date().toISOString(),
    }),
  });
}

/**
 * Persist a boot verdict. `state='running'` from VMOS is not proof a device can
 * serve a job — this is, and the automator can filter on it.
 */
export async function recordDeviceBootHealth(deviceId, { health, bootMs = null }) {
  return supabaseFetch(`devices?id=eq.${deviceId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      boot_health: health,
      boot_ms: bootMs,
      boot_checked_at: new Date().toISOString(),
    }),
  });
}

/** Sleep helper — every sweep script polls something. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `worker` over `items` with at most `limit` in flight, preserving order.
 * Used by every bulk script to honour the VMOS ceiling of 10 running containers
 * per box. A `limit` of 0 or less runs serially rather than dropping the work.
 */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Math.min(Math.max(1, limit), items.length);
  await Promise.all(
    Array.from({ length: runners }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    }),
  );
  return results;
}
