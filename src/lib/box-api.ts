/**
 * Server-side helper to call box VMOS APIs via Cloudflare Tunnel.
 * All requests include CF-Access headers for authentication.
 *
 * Layered architecture:
 *   - Low-level HTTP    : `boxFetch` (single fetch primitive, CF-auth)
 *   - VMOS resources    : `fetchContainer*`, `fetchTimezoneLocale`, etc.
 *   - Shell primitives  : `shell` (throws on container-not-ready), `shellSafe`,
 *                         `screenshot`. All Android-specific helpers (wake, IME,
 *                         text input, focus tracking) live in
 *                         `src/lib/automation/adb-helpers.ts` on top of these.
 *   - Lifecycle         : `ensureContainerReady` (boot + Android boot_completed
 *                         polling), `stopContainerIfIdle`.
 */

import { createHash } from "node:crypto";

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

interface VmosShellData {
  cmd?: string;       // present only when VMOS forwarded the command to Android
  db_id?: string;
  host_ip: string;
  message?: string;   // command stdout, OR the Android exception text on cmd failure
}

// ---------------------------------------------------------------------------
// Public API — VMOS resources
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
// Shell primitives
// ---------------------------------------------------------------------------

/**
 * Thrown when VMOS reports the container is not running (code 201). All
 * Android shell calls are no-ops in that state — callers must abort the
 * automation rather than continue typing into a dead container.
 */
export class ContainerNotReadyError extends Error {
  constructor(public readonly dbId: string, public readonly cmd?: string) {
    super(`Container ${dbId} not ready (VMOS code 201)${cmd ? ` for cmd: ${cmd.slice(0, 80)}` : ""}`);
    this.name = "ContainerNotReadyError";
  }
}

export interface ShellResult {
  code: number;
  message: string;
}

function logShell(dbId: string, ok: boolean, cmd: string, code: number, message: string, ms: number) {
  const tag = ok ? "OK" : "WARN";
  console.log(`[ADB][${dbId}] shell ${tag}`, JSON.stringify({
    cmd: cmd.length > 80 ? cmd.slice(0, 80) + "…" : cmd,
    code,
    output: message.length > 200 ? message.slice(0, 200) + "…" : message,
    ms,
  }));
}

/**
 * Run a shell command on the device through VMOS. Throws
 * `ContainerNotReadyError` when VMOS reports the container is not running so
 * automation cannot silently proceed against a dead device.
 *
 * VMOS overloads code 201 for two very different cases:
 *   1. Container not running — `data.cmd` is absent because VMOS never even
 *      forwarded the request to Android. `msg` is something like
 *      "实例未运行" / "instance not running".
 *   2. Container running but the shell command itself failed (bad args,
 *      Android-level exception, non-zero exit). `data.cmd` echoes the
 *      command and `data.message` carries the stderr/exception text.
 *
 * Only case 1 is `ContainerNotReadyError`. Case 2 is returned as a normal
 * result (with code 201) so the caller — which has the platform context —
 * can decide how to react (typically wrap as a `JobError("ui_unexpected")`).
 */
export async function shell(
  tunnelHostname: string,
  dbId: string,
  cmd: string,
): Promise<ShellResult> {
  const start = Date.now();
  const res = await boxFetch<VmosResponse<VmosShellData>>(
    tunnelHostname,
    `/android_api/v1/shell/${dbId}`,
    {
      method: "POST",
      body: JSON.stringify({ id: dbId, cmd }),
    },
  );

  const code = res.code ?? -1;
  const message = res.data?.message ?? "";
  const ms = Date.now() - start;
  logShell(dbId, code === 200, cmd, code, message, ms);

  if (code === 201 && !res.data?.cmd) {
    // VMOS never reached the device — container is down (or the request
    // was malformed). Either way the automation cannot proceed.
    throw new ContainerNotReadyError(dbId, cmd);
  }
  return { code, message };
}

/**
 * Same as `shell` but never throws — returns null when the container is not
 * ready. Use exclusively for cleanup paths (e.g. IME restore) where a failure
 * to communicate must not mask the real error.
 */
export async function shellSafe(
  tunnelHostname: string,
  dbId: string,
  cmd: string,
): Promise<ShellResult | null> {
  try {
    return await shell(tunnelHostname, dbId, cmd);
  } catch {
    return null;
  }
}

/**
 * VMOS caches `/container_api/v1/screenshots/<dbId>` server-side for ~5s, so
 * two reads inside that window return byte-identical JPEGs even though the
 * device screen has changed. That breaks any "before / after" automation
 * proof. We work around it adaptively: keep the previous content hash per
 * device in memory; if a fresh fetch returns the same hash, retry up to N
 * times with a small delay until VMOS regenerates. Bounded so a genuinely
 * static screen never blocks (max ~3s extra wait).
 */
const SCREENSHOT_RETRY_INTERVAL_MS = 1000;
const SCREENSHOT_MAX_RETRIES = 3;
const lastScreenshotHash = new Map<string, string>();

async function fetchScreenshotRaw(
  tunnelHostname: string,
  dbId: string,
): Promise<Buffer> {
  const start = Date.now();
  const url = `https://${tunnelHostname}/container_api/v1/screenshots/${dbId}`;
  const res = await fetch(url, { headers: getCfHeaders(), cache: "no-store" });
  const ms = Date.now() - start;

  if (!res.ok) {
    console.error(`[ADB][${dbId}] screenshot FAILED`, JSON.stringify({ httpStatus: res.status, ms }));
    return Buffer.alloc(0);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`[ADB][${dbId}] screenshot OK`, JSON.stringify({ bytes: buf.length, ms }));
  return buf;
}

export async function screenshot(
  tunnelHostname: string,
  dbId: string,
): Promise<Buffer> {
  const previous = lastScreenshotHash.get(dbId);
  let buf = await fetchScreenshotRaw(tunnelHostname, dbId);

  for (let attempt = 1; attempt <= SCREENSHOT_MAX_RETRIES; attempt++) {
    if (buf.length === 0) break; // transport failure — return as-is
    const hash = createHash("sha256").update(buf).digest("hex");
    if (hash !== previous) {
      lastScreenshotHash.set(dbId, hash);
      return buf;
    }
    console.log(`[ADB][${dbId}] screenshot stale (cache hit), retry ${attempt}/${SCREENSHOT_MAX_RETRIES}`);
    await new Promise((r) => setTimeout(r, SCREENSHOT_RETRY_INTERVAL_MS));
    buf = await fetchScreenshotRaw(tunnelHostname, dbId);
  }

  // Either the screen really hasn't changed or we hit the retry cap. Either
  // way, return what we have so the caller doesn't block forever.
  if (buf.length > 0) {
    lastScreenshotHash.set(dbId, createHash("sha256").update(buf).digest("hex"));
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Container lifecycle
// ---------------------------------------------------------------------------

const CONTAINER_RUN_POLL_MS = 1500;
const CONTAINER_RUN_TIMEOUT_MS = 30_000;
const ANDROID_BOOT_POLL_MS = 1500;
const ANDROID_BOOT_TIMEOUT_MS = 90_000;

/**
 * Ensure the container is running AND Android has finished booting.
 *
 * VMOS reports `status=running` as soon as the container process is up, but
 * Android still needs ~10–30s to mount /system, start zygote, system_server
 * and reach `sys.boot_completed=1`. Without the second wait, every shell call
 * returns code 201 silently and automations tap into the void.
 *
 * Returns once `getprop sys.boot_completed` returns "1" via shell. Throws
 * if the deadline is reached.
 */
export async function ensureContainerReady(
  tunnelHostname: string,
  dbId: string,
): Promise<{ wasStarted: boolean; durationMs: number }> {
  const start = Date.now();
  const detail = await fetchContainerDetail(tunnelHostname, dbId);
  let wasStarted = false;

  if (detail?.status !== "running") {
    console.log(`[Container] ${dbId} status=${detail?.status ?? "unknown"} — issuing run`);
    await boxFetch(tunnelHostname, "/container_api/v1/run", {
      method: "POST",
      body: JSON.stringify({ db_ids: [dbId] }),
    });
    wasStarted = true;
    await waitForContainerStatus(tunnelHostname, dbId, "running", CONTAINER_RUN_TIMEOUT_MS);
  }

  await waitForBootCompleted(tunnelHostname, dbId, ANDROID_BOOT_TIMEOUT_MS);
  const durationMs = Date.now() - start;
  console.log(`[Container] ${dbId} ready (wasStarted=${wasStarted}, durationMs=${durationMs})`);
  return { wasStarted, durationMs };
}

async function waitForContainerStatus(
  tunnelHostname: string,
  dbId: string,
  expected: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, CONTAINER_RUN_POLL_MS));
    const check = await fetchContainerDetail(tunnelHostname, dbId);
    if (check?.status === expected) return;
  }
  throw new Error(`Container ${dbId} did not reach status=${expected} within ${timeoutMs}ms`);
}

async function waitForBootCompleted(
  tunnelHostname: string,
  dbId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await shellSafe(tunnelHostname, dbId, "getprop sys.boot_completed");
    if (result && result.code === 200 && result.message.trim() === "1") return;
    await new Promise((r) => setTimeout(r, ANDROID_BOOT_POLL_MS));
  }
  throw new Error(`Container ${dbId} did not finish booting within ${timeoutMs}ms`);
}

/**
 * Stop the container if no other ready/executing jobs target this device.
 * Best-effort: a network failure is logged but does not throw.
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
    await supabase
      .from("devices")
      .update({ state: "stopped", last_seen: new Date().toISOString() })
      .eq("id", deviceId);
  } catch (err) {
    console.error(`[Container] ${dbId} stop failed:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Stop the container unconditionally. Used by operator-initiated stop.
 */
export async function stopContainer(
  tunnelHostname: string,
  dbId: string,
): Promise<void> {
  await boxFetch(tunnelHostname, "/container_api/v1/stop", {
    method: "POST",
    body: JSON.stringify({ db_ids: [dbId] }),
  });
}

export { boxFetch, getCfHeaders };
