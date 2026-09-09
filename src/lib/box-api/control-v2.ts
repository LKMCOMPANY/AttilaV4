/**
 * Android Control API v2 (`/android_api/v2/{db_id}/…`) — the in-guest agent
 * that serves the accessibility tree, selector-based actions, gestures,
 * screenshots and package facts.
 *
 * Measured facts this module is built around (9 September 2026, agents 1.1.1
 * and 1.1.3, see MAINTENANCE-AGENT.md):
 *   - the agent may be unreachable from the host for a while after `run`
 *     (stale Docker route) → `waitForControlApi` retries, and the in-guest
 *     fallback (`curl 127.0.0.1:18185` through the v1 shell) always works;
 *   - `text` / `content_desc` selectors are strict, case-sensitive equalities;
 *     `xpath` with `contains()` and `@resource-id` are the reliable forms; a
 *     miss costs the whole `wait_timeout` and comes back either as HTTP 404 or
 *     as code 200 with `count: 0` — callers must look at the count;
 *   - `class_name` does not filter; boolean xpath predicates miss;
 *   - `base/list_action` and `package/info` want POST bodies;
 *   - text entry into social apps stays on the ADBKeyboard broadcast: this
 *     module deliberately exposes no `set_text` / `input/text`.
 */

import { gunzipSync } from "node:zlib";
import { boxFetch, boxFetchBytes } from "./fetch";
import { shell } from "./shell";

export interface V2Envelope<T> {
  request_id?: string;
  code: number;
  msg?: string;
  data: T;
  /** Device-side cost in ms, when the agent reports it. */
  cost?: number;
}

export class ControlApiError extends Error {
  constructor(
    public readonly dbId: string,
    public readonly path: string,
    public readonly code: number,
    message: string,
  ) {
    super(`Control API ${path} on ${dbId} → code ${code}: ${message}`);
    this.name = "ControlApiError";
  }
}

export interface ControlApiVersion {
  versionName: string;
  versionCode: number;
  /** Route inventory advertised by the agent; the authoritative capability list. */
  supportedList: string[];
  /** Minor line the fleet mixes today: "1.1.1" (image 20260417) or "1.1.3" (20260511+). */
  agentLine: string;
}

export type V2Selector =
  | { xpath: string }
  | { resource_id: string }
  | { text: string }
  | { content_desc: string };

/** Actions the engine allows through the selector route. No text injection. */
export type V2NodeAction =
  | "click"
  | "long_click"
  | "focus"
  | "scroll_forward"
  | "scroll_backward"
  | "scroll_up"
  | "scroll_down";

export interface V2Node {
  text?: string;
  class?: string;
  package?: string;
  content_desc?: string;
  resource_id?: string;
  bounds?: { left: number; top: number; right: number; bottom: number };
  center_x?: number;
  center_y?: number;
  clickable?: boolean;
  enabled?: boolean;
  focusable?: boolean;
  focused?: boolean;
  scrollable?: boolean;
  long_clickable?: boolean;
  checkable?: boolean;
  checked?: boolean;
  selected?: boolean;
}

export interface V2PackageInfo {
  package_name: string;
  version_name?: string;
  version_code?: number;
  app_name?: string;
  is_system?: boolean;
  enabled?: boolean;
  launcher_activity?: string;
}

const v2Path = (dbId: string, path: string) => `/android_api/v2/${dbId}/${path}`;

async function v2Get<T>(tunnelHostname: string, dbId: string, path: string, timeoutMs?: number) {
  const res = await boxFetch<V2Envelope<T>>(tunnelHostname, v2Path(dbId, path), {
    retries: 0,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  if (res.code !== 200) throw new ControlApiError(dbId, path, res.code, res.msg ?? "");
  return res;
}

async function v2Post<T>(
  tunnelHostname: string,
  dbId: string,
  path: string,
  body: unknown,
  timeoutMs?: number,
) {
  const res = await boxFetch<V2Envelope<T>>(tunnelHostname, v2Path(dbId, path), {
    method: "POST",
    body: JSON.stringify(body),
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  if (res.code !== 200) throw new ControlApiError(dbId, path, res.code, res.msg ?? "");
  return res;
}

function isNotFound(err: unknown): boolean {
  if (err instanceof ControlApiError) return err.code === 404;
  return err instanceof Error && /Box API error: 404\b/.test(err.message);
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

interface RawVersionInfo {
  version_name?: string;
  version_code?: number;
  supported_list?: string[];
}

function toVersion(raw: RawVersionInfo): ControlApiVersion {
  const versionName = raw.version_name ?? "";
  return {
    versionName,
    versionCode: raw.version_code ?? 0,
    supportedList: raw.supported_list ?? [],
    agentLine: versionName.split(".").slice(0, 3).join("."),
  };
}

/** One probe of the in-guest agent from the host route. Null when unreachable. */
export async function fetchControlApiVersion(
  tunnelHostname: string,
  dbId: string,
): Promise<ControlApiVersion | null> {
  try {
    const res = await v2Get<RawVersionInfo>(tunnelHostname, dbId, "base/version_info", 8_000);
    return toVersion(res.data ?? {});
  } catch {
    return null;
  }
}

/**
 * Wait for the v2 agent after a container start. The host sometimes keeps
 * routing to the container's previous Docker IP for a while, so a booted
 * Android is not proof that v2 answers — probe with retries and report how
 * long it took, so the engine can decide whether to fall back in-guest.
 */
export async function waitForControlApi(
  tunnelHostname: string,
  dbId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ version: ControlApiVersion | null; attempts: number; durationMs: number }> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const start = Date.now();
  let attempts = 0;
  while (Date.now() - start < timeoutMs) {
    attempts++;
    const version = await fetchControlApiVersion(tunnelHostname, dbId);
    if (version) return { version, attempts, durationMs: Date.now() - start };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { version: null, attempts, durationMs: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Raw compact tree text from the host route. Throws when the agent is unreachable. */
export async function fetchDumpCompact(tunnelHostname: string, dbId: string): Promise<string> {
  const res = await v2Get<string>(tunnelHostname, dbId, "accessibility/dump_compact", 15_000);
  return typeof res.data === "string" ? res.data : "";
}

// The VMOS shell transport truncates stdout at ~4 KB. A gzip+base64 feed tree
// is 1–8 KB, so the fallback snapshots the payload to a file once and reads it
// back in fixed-size slices — one screen, several cheap calls.
const IN_GUEST_SNAPSHOT = "/sdcard/.attila_dump_compact.b64";
const IN_GUEST_SLICE = 3_600;
const IN_GUEST_MAX_SLICES = 12;

/**
 * Read `dump_compact` from INSIDE the guest through the v1 shell — the path
 * that works when the host cannot route to the agent (`no route to host`).
 * Returns null when the guest itself does not answer.
 */
export async function fetchDumpCompactInGuest(
  tunnelHostname: string,
  dbId: string,
): Promise<string | null> {
  const snapshot = await shell(
    tunnelHostname,
    dbId,
    `curl -s -m 8 http://127.0.0.1:18185/api/accessibility/dump_compact | gzip -c | base64 -w0 > ${IN_GUEST_SNAPSHOT}; wc -c < ${IN_GUEST_SNAPSHOT}`,
  );
  const total = Number.parseInt(snapshot.message.trim(), 10);
  if (!Number.isFinite(total) || total <= 0) return null;

  let b64 = "";
  for (let slice = 0; slice < IN_GUEST_MAX_SLICES && b64.length < total; slice++) {
    const from = slice * IN_GUEST_SLICE + 1;
    const to = from + IN_GUEST_SLICE - 1;
    const part = await shell(tunnelHostname, dbId, `cut -c${from}-${to} ${IN_GUEST_SNAPSHOT}`);
    if (part.code !== 200) return null;
    b64 += part.message.trim();
  }
  if (b64.length < total) return null;

  try {
    const json = gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
    const parsed = JSON.parse(json) as V2Envelope<string>;
    return parsed.code === 200 && typeof parsed.data === "string" ? parsed.data : null;
  } catch {
    return null;
  }
}

/** JPEG screenshot from the v2 agent (raw bytes). Empty buffer on failure. */
export async function fetchScreenshotJpeg(
  tunnelHostname: string,
  dbId: string,
  quality = 55,
): Promise<Buffer> {
  try {
    const res = await boxFetchBytes(
      tunnelHostname,
      v2Path(dbId, `screenshot/format?format=jpeg&quality=${quality}`),
      15_000,
    );
    return res.ok ? res.body : Buffer.alloc(0);
  } catch {
    return Buffer.alloc(0);
  }
}

/**
 * Find nodes matching `selector` without acting. A miss is an empty array —
 * the agent answers either HTTP 404 or code 200 / count 0 depending on the
 * build, and both mean the same thing here.
 */
export async function queryNodes(
  tunnelHostname: string,
  dbId: string,
  selector: V2Selector,
  waitTimeoutMs = 0,
): Promise<V2Node[]> {
  try {
    const res = await v2Post<{ count?: number; nodes?: V2Node[] }>(
      tunnelHostname,
      dbId,
      "accessibility/node",
      { selector, wait_timeout: waitTimeoutMs },
      waitTimeoutMs + 15_000,
    );
    return res.data?.nodes ?? [];
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
}

/**
 * Find-and-act in one call. Returns `false` when no node matched (the action
 * was not performed); throws on transport or agent errors.
 */
export async function actOnNode(
  tunnelHostname: string,
  dbId: string,
  selector: V2Selector,
  action: V2NodeAction,
  waitTimeoutMs = 2_000,
): Promise<boolean> {
  try {
    const res = await v2Post<{ count?: number; action_success?: boolean }>(
      tunnelHostname,
      dbId,
      "accessibility/node",
      { selector, wait_timeout: waitTimeoutMs, action },
      waitTimeoutMs + 15_000,
    );
    const count = res.data?.count ?? 0;
    return count > 0 && res.data?.action_success !== false;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Gestures
// ---------------------------------------------------------------------------

export interface BezierScroll {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  durationMs: number;
}

/** Curved, variable-speed scroll — the human-looking gesture the engine uses. */
export async function scrollBezier(
  tunnelHostname: string,
  dbId: string,
  gesture: BezierScroll,
): Promise<void> {
  await v2Post(tunnelHostname, dbId, "input/scroll_bezier", {
    start_x: Math.round(gesture.startX),
    start_y: Math.round(gesture.startY),
    end_x: Math.round(gesture.endX),
    end_y: Math.round(gesture.endY),
    duration: Math.round(gesture.durationMs),
  });
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

/**
 * Installed user packages with versions. On 1.1.3 the default listing only
 * covers launcher apps, so callers that need specific packages should use
 * `fetchPackageInfo` first and fall back here.
 */
export async function fetchPackageList(
  tunnelHostname: string,
  dbId: string,
): Promise<V2PackageInfo[]> {
  const res = await v2Get<{ packages?: V2PackageInfo[] } | V2PackageInfo[]>(
    tunnelHostname,
    dbId,
    "package/list",
    15_000,
  );
  if (Array.isArray(res.data)) return res.data;
  return res.data?.packages ?? [];
}

/**
 * Versions of specific packages. `package/info` exists from agent 1.1.3 and
 * wants a POST body; on 1.1.1 (route absent) we fall back to the full list.
 */
export async function fetchPackageInfo(
  tunnelHostname: string,
  dbId: string,
  packageNames: readonly string[],
): Promise<V2PackageInfo[]> {
  try {
    const res = await v2Post<{ packages?: V2PackageInfo[] } | V2PackageInfo[]>(
      tunnelHostname,
      dbId,
      "package/info",
      { package_names: [...packageNames] },
      15_000,
    );
    const list = Array.isArray(res.data) ? res.data : res.data?.packages ?? [];
    if (list.length > 0) return list;
  } catch (err) {
    if (!isNotFound(err) && !(err instanceof ControlApiError)) throw err;
  }
  const all = await fetchPackageList(tunnelHostname, dbId);
  return all.filter((p) => packageNames.includes(p.package_name));
}
