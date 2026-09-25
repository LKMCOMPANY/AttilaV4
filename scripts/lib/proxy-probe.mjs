/**
 * Per-device proxy probes, shared by every sweep that has a device up.
 *
 * Two questions, two probes, one definition each (25 September 2026 — before
 * that `audit-proxies.mjs` and `audit-proxy-fleet.mjs` each carried their own):
 *
 *   readProxyConfig   what VMOS has CONFIGURED for the container (`proxy_get`,
 *                     only answers while it runs) — written back to the DB so
 *                     `devices.proxy_*` mirrors the truth;
 *   probeRouting      whether that proxy actually ROUTES (`/proxy-test/{dbId}`
 *                     on the box: mihomo delay to a neutral 204 endpoint) and,
 *                     with `geo`, where the guest's own egress comes out
 *                     (`curl ipinfo.io` from inside the guest — the only request
 *                     that traverses the session's real exit).
 *
 * Neither starts or stops anything: the caller owns the container lifecycle.
 * Never log the raw `proxy_get` payload — it carries the proxy password.
 */

import { fetchProxyConfig, proxyTest, recordDeviceProxy, shell, sleep } from "./fleet.mjs";

// cbs settles the mihomo state a moment after boot_completed; reading earlier
// returns the previous container's config on some CBS builds.
const PROXY_SETTLE_MS = 1_500;

/**
 * Read the configured proxy of a RUNNING device and mirror it in the DB.
 * Returns `{ status: "proxied" | "no_proxy", detail, cfg }`.
 */
export async function readProxyConfig(boxHost, device, { dryRun = false } = {}) {
  await sleep(PROXY_SETTLE_MS);
  const cfg = await fetchProxyConfig(boxHost, device.db_id).catch(() => null);
  if (cfg && cfg.enabled && cfg.ip) {
    if (!dryRun) await recordDeviceProxy(device.id, cfg);
    return { status: "proxied", detail: `${cfg.proxyType} ${cfg.ip}:${cfg.port}`, cfg };
  }
  if (!dryRun) await recordDeviceProxy(device.id, null);
  return { status: "no_proxy", detail: "no proxy configured", cfg: null };
}

/**
 * The country the avatar is supposed to live in. `user_name` carries it as a
 * prefix (FR90, US2, GB48) and is the value the provisioning flow keys on, so
 * it is the intent; `country` on the row is only filled for some devices.
 */
export function expectedCountry(device) {
  const fromColumn = device.country?.trim().toUpperCase();
  if (fromColumn && fromColumn.length === 2) return fromColumn;
  const match = (device.user_name ?? "").match(/^([A-Za-z]{2})\d/);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Routing verdict from a `/proxy-test` result, honest about stopped devices.
 * Contract: `infra/magicbox-proxy/test/fixtures/proxy-test.json`. Since proxy
 * 1.3.1 the box also probes the in-guest engine ("vpn" mode) and answers
 * `engine: guest` with the guest's `exit`; `unproxied` means the guest leaves
 * through the box's own WAN address — the one verdict that is a leak.
 */
export function classifyRouting(device, result) {
  const engine = result.engine ? ` (${result.engine} engine)` : "";
  if (result.ok && typeof result.delayMs === "number") return { tag: "ROUTES", detail: `${result.delayMs} ms${engine}`, exit: result.exit ?? null };
  const err = String(result.error ?? "unknown");
  if (/\bunproxied\b/i.test(err)) return { tag: "UNPROXIED", detail: `guest exits through the box's own address${engine}`, exit: result.exit ?? null };
  if (/\bengine_starting\b/i.test(err)) return { tag: "starting", detail: "in-guest engine up, TUN not routing yet" };
  if (/engine_unreachable|ECONNREFUSED|503|timeout/i.test(err)) {
    return device.state === "running"
      ? { tag: "DOWN", detail: "engine down while running — investigate" }
      : { tag: "stopped", detail: "not running (start to test)" };
  }
  // proxy ≤ 1.3.0 answered this for a container without a host-side mihomo.json;
  // 1.3.1 asks the guest instead. Kept for a box not yet redeployed.
  if (/proxy_not_provisioned|404/i.test(err)) return { tag: "no-engine", detail: "no host-side engine (proxy < 1.3.1 cannot tell)" };
  if (/unreachable/i.test(err)) return { tag: "DOWN", detail: `upstream proxy did not respond${engine}` };
  return { tag: "FAIL", detail: err.slice(0, 80) };
}

/**
 * The device's real egress, seen from inside the guest so the request actually
 * goes through the proxy. Returns `null` when the device cannot reach the
 * internet at all — which is itself the answer.
 */
export async function fetchExitGeo(boxHost, dbId) {
  try {
    const res = await shell(boxHost, dbId, "curl -s -m 12 https://ipinfo.io/json");
    if (!res.ok) return null;
    const body = JSON.parse(res.message.trim());
    return body?.country ? { ip: body.ip, country: body.country, city: body.city } : null;
  } catch {
    return null;
  }
}

/**
 * Routing + (optional) exit-geo verdict for one device that is RUNNING.
 * Returns `{ tag, detail, geo? }` where `geo = { exit, expected, coherent }`.
 * Only a routing proxy is asked where it comes out.
 */
// An in-guest engine brings its TUN up 15–20 s after boot_completed (measured
// on CA2, box-3, 26 Sep 2026); until then the guest egresses through the box.
// The probe polls through that window before calling anything unproxied.
const ENGINE_STARTING_BUDGET_MS = 45_000;
const ENGINE_STARTING_POLL_MS = 5_000;

export async function probeRouting(boxHost, device, { geo = false } = {}) {
  const started = Date.now();
  let result = await proxyTest(boxHost, device.db_id);
  while (result?.error === "engine_starting" && Date.now() - started < ENGINE_STARTING_BUDGET_MS) {
    await sleep(ENGINE_STARTING_POLL_MS);
    result = await proxyTest(boxHost, device.db_id);
  }
  const row = classifyRouting({ ...device, state: "running" }, result);
  if (result?.error === "engine_starting") row.detail += ` after ${Math.round((Date.now() - started) / 1000)} s`;
  if (geo && (row.tag === "ROUTES" || row.tag === "UNPROXIED")) {
    // The guest-engine probe already carries the exit; the host-engine one does not.
    const exit = row.exit ?? (await fetchExitGeo(boxHost, device.db_id));
    const expected = expectedCountry(device);
    row.geo = { exit, expected, coherent: !exit || !expected || exit.country === expected };
  }
  return row;
}

/** One-line rendering of a `probeRouting` verdict for sweep logs. */
export function describeRouting(row) {
  let geo = "";
  if (row.geo) {
    geo = row.geo.exit
      ? `  exit=${row.geo.exit.country}/${row.geo.exit.city ?? "?"}` +
        (row.geo.coherent ? "" : `  MISMATCH (expected ${row.geo.expected})`)
      : "  exit=unreachable";
  }
  return `${row.tag.padEnd(9)} ${row.detail}${geo}`;
}
