/**
 * Per-device proxy probes, shared by every sweep that has a device up.
 *
 * Two questions, two probes, one definition each (25 September 2026 — before
 * that `audit-proxies.mjs` and the fleet proxy audit each carried their own):
 *
 *   readProxyConfig   what VMOS has CONFIGURED for the container (`proxy_get`,
 *                     only answers while it runs) — written back to the DB so
 *                     `devices.proxy_*` mirrors the truth;
 *   probeRouting      whether that proxy actually ROUTES (`/proxy-test/{dbId}`
 *                     on the box, contract `infra/magicbox-proxy/test/fixtures/
 *                     proxy-test.json`) and, with `geo`, where the guest's own
 *                     egress comes out — from the probe itself for an in-guest
 *                     engine, from `curl ipinfo.io` inside the guest otherwise
 *                     (the only request that traverses the session's real exit).
 *
 * The verdicts are pure functions in `proxy-verdict.mjs` (tested); this file
 * only does I/O. Neither starts or stops anything: the caller owns the
 * container lifecycle. Never log the raw `proxy_get` payload — it carries the
 * proxy password.
 */

import { fetchProxyConfig, proxyTest, recordDeviceProxy, shell, sleep } from "./fleet.mjs";
import { classifyRouting, geoCoherence } from "./proxy-verdict.mjs";

export { describeRouting } from "./proxy-verdict.mjs";

// cbs settles the mihomo state a moment after boot_completed; reading earlier
// returns the previous container's config on some CBS builds.
const PROXY_SETTLE_MS = 1_500;
// `proxy_get` on an in-guest engine intermittently answers "no proxy" for a
// device that is configured (4 devices per box-3 pass, measured 26 Sep 2026;
// CA1 read empty at 13:10 and held port 8138 all along — the port was handed
// to FR17 on the strength of that read). A device the mirror knows as proxied
// is asked again before its row is cleared.
const NO_PROXY_RECHECK_MS = 8_000;

// An in-guest engine brings its TUN up 15–20 s after boot_completed (measured
// on CA2, box-3, 26 Sep 2026); until then the guest egresses through the box.
// The probe polls through that window before calling anything unproxied.
const ENGINE_STARTING_BUDGET_MS = 45_000;
const ENGINE_STARTING_POLL_MS = 5_000;

/**
 * Read the configured proxy of a RUNNING device and mirror it in the DB.
 * Returns `{ status: "proxied" | "no_proxy", detail, cfg }`.
 */
export async function readProxyConfig(boxHost, device, { dryRun = false } = {}) {
  await sleep(PROXY_SETTLE_MS);
  let cfg = await fetchProxyConfig(boxHost, device.db_id).catch(() => null);
  if (!(cfg && cfg.enabled && cfg.ip) && device.proxy_host) {
    await sleep(NO_PROXY_RECHECK_MS);
    cfg = await fetchProxyConfig(boxHost, device.db_id).catch(() => null);
  }
  if (cfg && cfg.enabled && cfg.ip) {
    if (!dryRun) await recordDeviceProxy(device.id, cfg);
    return { status: "proxied", detail: `${cfg.proxyType} ${cfg.ip}:${cfg.port}`, cfg };
  }
  if (!dryRun) await recordDeviceProxy(device.id, null);
  return { status: "no_proxy", detail: "no proxy configured", cfg: null };
}

/**
 * The device's real egress, seen from inside the guest so the request actually
 * goes through the proxy. Returns `null` when the device cannot reach the
 * internet at all — which is itself the answer.
 */
async function fetchExitGeo(boxHost, dbId) {
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
 * Routing + (optional) exit-geo verdict for one device. `device.state` is what
 * the caller knows (a sweep that just booted the device passes `running`; the
 * read-only audit passes the database row), so a silent engine on a stopped
 * device reads "stopped", not "DOWN". Returns `{ tag, detail, exit?, geo? }`
 * where `geo = { exit, expected, coherent }`; only a routing (or leaking)
 * proxy is asked where it comes out.
 * @param {string} boxHost
 * @param {{ db_id: string, user_name?: string | null, country?: string | null, state?: string }} device
 * @param {{ geo?: boolean }} [options]
 * @returns {Promise<import("./proxy-verdict.mjs").RoutingVerdict>}
 */
export async function probeRouting(boxHost, device, { geo = false } = {}) {
  const started = Date.now();
  let result = await proxyTest(boxHost, device.db_id);
  while (result?.error === "engine_starting" && Date.now() - started < ENGINE_STARTING_BUDGET_MS) {
    await sleep(ENGINE_STARTING_POLL_MS);
    result = await proxyTest(boxHost, device.db_id);
  }
  // A host engine reloading its upstream (just after a `proxy_set`) lets the
  // guest out through the box for a few seconds — GB35, box-2, 26 Sep 2026:
  // unproxied at +2 s, GB/London at +8 s. One second look before the verdict.
  if (result?.error === "unproxied") {
    await sleep(ENGINE_STARTING_POLL_MS);
    result = await proxyTest(boxHost, device.db_id);
  }
  const row = classifyRouting(device, result);
  if (result?.error === "engine_starting") row.detail += ` after ${Math.round((Date.now() - started) / 1000)} s`;
  if (geo && (row.tag === "ROUTES" || row.tag === "UNPROXIED")) {
    // The box measures the exit itself (proxy ≥ 1.3.3); right after a
    // `proxy_set` the host engine reloads and the first read can come back
    // without one — ask again before falling back to the guest's own curl.
    let exit = row.exit ?? null;
    for (let attempt = 0; !exit && attempt < 2; attempt++) {
      await sleep(4000);
      exit = classifyRouting(device, await proxyTest(boxHost, device.db_id)).exit ?? null;
    }
    exit ??= await fetchExitGeo(boxHost, device.db_id);
    row.geo = geoCoherence(device, exit);
  }
  return row;
}
