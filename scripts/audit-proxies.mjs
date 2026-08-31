/**
 * READ-ONLY proxy audit — "which proxies actually route".
 *
 * For every proxy-enabled device on a reachable box, runs the on-box
 * `/proxy-test/{dbId}` probe (mihomo delay through the upstream, to a neutral
 * 204 endpoint). This is the REAL routing verdict, unlike `proxy_get` which only
 * reports the configured proxy.
 *
 * mihomo only listens while the container is RUNNING, so a stopped device
 * reports `engine_unreachable` — that is expected and shown as "stopped", not a
 * dead proxy. Touches nothing: no container is started or stopped.
 *
 * With `--geo` it also checks that the exit IP lands where the avatar claims to
 * live. A French persona egressing from a German IP is a detection risk that a
 * latency probe cannot see.
 *
 * Note this asks the DEVICE for its own public IP rather than using the box's
 * `/android_api/v1/ip_geo/{db_id}`: that endpoint geolocates the CONFIGURED
 * proxy hostname (`disp.oxylabs.io` resolves to the dispatcher in Falkenstein),
 * not the session's actual egress. Only a request made from inside the guest
 * traverses the proxy and reveals the real exit.
 *
 * Usage (from Attila V4/):
 *   node scripts/audit-proxies.mjs                # all proxied devices
 *   node scripts/audit-proxies.mjs --running-only # skip stopped devices
 *   node scripts/audit-proxies.mjs --geo          # + exit-IP geo coherence
 *   node scripts/audit-proxies.mjs --concurrency 4
 */

import { fetchProxiedDevices, proxyTest, shell, mapWithConcurrency } from "./lib/fleet.mjs";

function parseArgs(argv) {
  const args = { runningOnly: false, concurrency: 3, geo: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--running-only") args.runningOnly = true;
    else if (argv[i] === "--geo") args.geo = true;
    else if (argv[i] === "--concurrency") args.concurrency = Number(argv[++i]) || 3;
  }
  return args;
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
 * The country the avatar is supposed to live in. `user_name` carries it as a
 * prefix (FR90, US2, GB48) and is the value the provisioning flow keys on, so
 * it is the intent; `country` on the row is only filled for some devices.
 */
function expectedCountry(device) {
  const fromColumn = device.country?.trim().toUpperCase();
  if (fromColumn && fromColumn.length === 2) return fromColumn;
  const match = (device.user_name ?? "").match(/^([A-Za-z]{2})\d/);
  return match ? match[1].toUpperCase() : null;
}

function classify(device, result) {
  if (result.ok && typeof result.delayMs === "number") return { tag: "ROUTES", detail: `${result.delayMs} ms` };
  const err = String(result.error ?? "unknown");
  if (/engine_unreachable|ECONNREFUSED|503|timeout/i.test(err)) {
    return device.state === "running"
      ? { tag: "DOWN", detail: "engine down while running — investigate" }
      : { tag: "stopped", detail: "not running (start to test)" };
  }
  if (/proxy_not_provisioned|404/i.test(err)) return { tag: "no-engine", detail: "no proxy engine provisioned" };
  if (/unreachable/i.test(err)) return { tag: "DOWN", detail: "upstream proxy did not respond" };
  return { tag: "FAIL", detail: err.slice(0, 80) };
}

async function main() {
  const args = parseArgs(process.argv);
  let devices = await fetchProxiedDevices();
  // box-3 is out of service; only test devices on reachable (online) boxes.
  devices = devices.filter((d) => d.boxes && d.boxes.status !== "offline");
  if (args.runningOnly) devices = devices.filter((d) => d.state === "running");

  console.log(`=== proxy routing audit — ${devices.length} proxy-enabled device(s) on online boxes ===\n`);

  const rows = await mapWithConcurrency(devices, args.concurrency, async (d) => {
    const host = d.boxes.tunnel_hostname;
    const result = await proxyTest(host, d.db_id);
    const row = { device: d, ...classify(d, result) };
    // Only a routing proxy can be asked where it comes out.
    if (args.geo && row.tag === "ROUTES") {
      const exit = await fetchExitGeo(host, d.db_id);
      const expected = expectedCountry(d);
      row.geo = { exit, expected, coherent: !exit || !expected || exit.country === expected };
    }
    return row;
  });

  const byBox = new Map();
  for (const r of rows) {
    const box = r.device.boxes.name;
    if (!byBox.has(box)) byBox.set(box, []);
    byBox.get(box).push(r);
  }

  const counts = { ROUTES: 0, DOWN: 0, stopped: 0, "no-engine": 0, FAIL: 0 };
  for (const box of [...byBox.keys()].sort()) {
    console.log(`── ${box} ──`);
    for (const r of byBox.get(box).sort((a, b) => (a.device.user_name || "").localeCompare(b.device.user_name || ""))) {
      counts[r.tag] = (counts[r.tag] ?? 0) + 1;
      const name = (r.device.user_name || r.device.db_id).padEnd(10);
      const proxy = `${r.device.proxy_host}:${r.device.proxy_port}`.padEnd(28);
      let geo = "";
      if (r.geo) {
        geo = r.geo.exit
          ? `  exit=${r.geo.exit.country}/${r.geo.exit.city ?? "?"}` +
            (r.geo.coherent ? "" : `  MISMATCH (expected ${r.geo.expected})`)
          : "  exit=unreachable";
      }
      console.log(`  ${name} ${proxy} ${r.tag.padEnd(9)} ${r.detail}${geo}`);
    }
    console.log("");
  }

  console.log("=== summary ===");
  console.log(`routes: ${counts.ROUTES}   down(running): ${counts.DOWN}   stopped: ${counts.stopped}   no-engine: ${counts["no-engine"]}   fail: ${counts.FAIL}`);
  if (args.geo) {
    const checked = rows.filter((r) => r.geo?.exit);
    const mismatched = checked.filter((r) => !r.geo.coherent);
    console.log(`geo checked: ${checked.length}   mismatched: ${mismatched.length}`);
    for (const r of mismatched) {
      console.log(`  ${r.device.user_name}: expected ${r.geo.expected}, exits ${r.geo.exit.country} (${r.geo.exit.ip})`);
    }
  }
  console.log("(only RUNNING devices give a meaningful verdict; start a device to test its proxy)");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
