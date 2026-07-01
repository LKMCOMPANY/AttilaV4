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

export type ProxyKind = "socks5" | "http";

export interface SetProxyInput {
  proxyType: ProxyKind;
  ip: string;
  port: number;
  account: string;
  password: string;
}

/**
 * Thrown when VMOS refuses `proxy_set` because the container is not running
 * (code 0 / "instance not running"). Verified on box-1..4 (06/2026): the
 * proxy can only be written while the container is up.
 */
export class ProxyTargetNotRunningError extends Error {
  constructor(public readonly dbId: string) {
    super(`Container ${dbId} must be running to update its proxy`);
    this.name = "ProxyTargetNotRunningError";
  }
}

/**
 * Write a proxy onto the device via the VMOS `proxy_set` endpoint.
 *
 * Verified behaviour (box-1..4, 06/2026): `cbs_go` (the ArmCloud backend)
 * rewrites the per-container host-side mihomo config and hot-reloads mihomo
 * immediately — the new proxy is LIVE, no container restart needed (confirmed
 * via the mihomo delay API: a freshly-set working upstream routes within ~1s).
 * Requires the container to be running, otherwise VMOS returns code 0 /
 * "instance not running" (a proxy set at create time is instead persisted and
 * applied on first start).
 */
export async function setProxyConfig(
  tunnelHostname: string,
  dbId: string,
  cfg: SetProxyInput,
): Promise<void> {
  const res = await boxFetch<VmosResponse<unknown>>(
    tunnelHostname,
    `/android_api/v1/proxy_set/${dbId}`,
    {
      method: "POST",
      body: JSON.stringify({
        proxyType: cfg.proxyType,
        proxyName: cfg.proxyType,
        ip: cfg.ip,
        port: cfg.port,
        account: cfg.account,
        password: cfg.password,
        dnsServers: ["8.8.8.8", "8.8.4.4"],
        udpDisabled: false,
        dnsOverProxyDisabled: false,
      }),
    },
  );

  if (res.code === 200) return;
  if (res.code === 0 || /not running|未运行/i.test(res.msg ?? "")) {
    throw new ProxyTargetNotRunningError(dbId);
  }
  throw new Error(`proxy_set failed (code ${res.code}): ${res.msg ?? "unknown error"}`);
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
 * Fetch a fresh device screenshot as a JPEG buffer.
 *
 * Uses the VMOS `no_cache=true` screenshot option (Edge screenshots v2), which
 * bypasses the ~5s server-side cache so every call returns the current frame.
 * This replaced a client-side content-hash retry workaround — verified on
 * box-1..5 (07/2026): back-to-back reads return distinct frames when the screen
 * changes, so the SOURCE/PROOF automation captures are reliable with no dedup.
 *
 * Returns an empty buffer on transport failure so a missing debug screenshot
 * never aborts the automation.
 */
export async function screenshot(
  tunnelHostname: string,
  dbId: string,
): Promise<Buffer> {
  const start = Date.now();
  const url = `https://${tunnelHostname}/container_api/v1/screenshots/${dbId}?no_cache=true`;
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

// ---------------------------------------------------------------------------
// Container lifecycle
// ---------------------------------------------------------------------------

const ROM_READY_POLL_MS = 1500;
const ROM_READY_TIMEOUT_MS = 120_000; // covers container start + Android boot
const BOOT_CONFIRM_RETRIES = 3;
const BOOT_CONFIRM_INTERVAL_MS = 1000;

/**
 * Ensure the container is running AND Android has finished booting.
 *
 * Fast path: poll the VMOS `rom_status` endpoint (code 200 = ROM ready) — one
 * lightweight GET that reflects both "container up" and "Android booted", so it
 * replaces the older two-phase (container-status + getprop) polling. A final
 * `getprop sys.boot_completed` then confirms Android's own signal before any
 * shell input is driven. Verified live (07/2026): `rom_status` never reports
 * 200 before `sys.boot_completed=1`, so this is a fast gate with a canonical
 * guard. Throws if the ROM is not ready within the deadline.
 */
export async function ensureContainerReady(
  tunnelHostname: string,
  dbId: string,
): Promise<{ wasStarted: boolean; durationMs: number }> {
  const start = Date.now();
  const { wasStarted } = await startContainerProcess(tunnelHostname, dbId);

  await waitForRomReady(tunnelHostname, dbId, ROM_READY_TIMEOUT_MS);
  await confirmBootCompleted(tunnelHostname, dbId);

  const durationMs = Date.now() - start;
  console.log(`[Container] ${dbId} ready (wasStarted=${wasStarted}, durationMs=${durationMs})`);
  return { wasStarted, durationMs };
}

/** VMOS ROM readiness code: 200 = ready, 1 = running but not ready, 0 = not started. */
async function fetchRomStatus(tunnelHostname: string, dbId: string): Promise<number> {
  const res = await boxFetch<VmosResponse<unknown>>(
    tunnelHostname,
    `/container_api/v1/rom_status/${dbId}`,
  );
  return res.code ?? -1;
}

/** Poll `rom_status` until the ROM reports ready (code 200) or the deadline hits. */
async function waitForRomReady(
  tunnelHostname: string,
  dbId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await fetchRomStatus(tunnelHostname, dbId)) === 200) return;
    await new Promise((r) => setTimeout(r, ROM_READY_POLL_MS));
  }
  throw new Error(`Container ${dbId} ROM not ready within ${timeoutMs}ms`);
}

/**
 * Canonical final guard: Android's own `sys.boot_completed`. rom_status==200 and
 * this flip together, but we confirm the OS signal (short retry) before driving
 * shell input — matches the automation contract that jobs run on a booted ROM.
 */
async function confirmBootCompleted(
  tunnelHostname: string,
  dbId: string,
): Promise<void> {
  for (let attempt = 0; attempt < BOOT_CONFIRM_RETRIES; attempt++) {
    const result = await shellSafe(tunnelHostname, dbId, "getprop sys.boot_completed");
    if (result && result.code === 200 && result.message.trim() === "1") return;
    await new Promise((r) => setTimeout(r, BOOT_CONFIRM_INTERVAL_MS));
  }
  throw new Error(`Container ${dbId} ROM ready but sys.boot_completed != 1`);
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
 * Issue the container `run` without waiting for Android to finish booting.
 *
 * Used by the operator "Start" action: the box only needs the run command;
 * actual streamability is gated client-side by the `/stream-ready` probe and
 * the stream's own warm-up retry. This keeps the Start button responsive
 * (~1–2s) instead of blocking for the full ~10–90s boot like
 * `ensureContainerReady` (which the automation pipeline still needs because it
 * immediately drives shell commands).
 */
export async function startContainerProcess(
  tunnelHostname: string,
  dbId: string,
): Promise<{ wasStarted: boolean }> {
  const detail = await fetchContainerDetail(tunnelHostname, dbId);
  if (detail?.status === "running") return { wasStarted: false };

  console.log(`[Container] ${dbId} status=${detail?.status ?? "unknown"} — issuing run`);
  await boxFetch(tunnelHostname, "/container_api/v1/run", {
    method: "POST",
    body: JSON.stringify({ db_ids: [dbId] }),
  });
  return { wasStarted: true };
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
