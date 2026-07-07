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
 * Usage (from Attila V4/):
 *   node scripts/audit-proxies.mjs                # all proxied devices
 *   node scripts/audit-proxies.mjs --running-only # skip stopped devices
 *   node scripts/audit-proxies.mjs --concurrency 4
 */

import { fetchProxiedDevices, proxyTest } from "./lib/fleet.mjs";

function parseArgs(argv) {
  const args = { runningOnly: false, concurrency: 3 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--running-only") args.runningOnly = true;
    else if (argv[i] === "--concurrency") args.concurrency = Number(argv[++i]) || 3;
  }
  return args;
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
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

  const rows = await mapLimit(devices, args.concurrency, async (d) => {
    const host = d.boxes.tunnel_hostname;
    const result = await proxyTest(host, d.db_id);
    return { device: d, ...classify(d, result) };
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
      console.log(`  ${name} ${proxy} ${r.tag.padEnd(9)} ${r.detail}`);
    }
    console.log("");
  }

  console.log("=== summary ===");
  console.log(`routes: ${counts.ROUTES}   down(running): ${counts.DOWN}   stopped: ${counts.stopped}   no-engine: ${counts["no-engine"]}   fail: ${counts.FAIL}`);
  console.log("(only RUNNING devices give a meaningful verdict; start a device to test its proxy)");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
