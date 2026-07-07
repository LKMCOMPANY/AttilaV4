/**
 * FULL fleet proxy audit — establishes the TRUE proxy coverage and repairs the
 * DB mirror.
 *
 * Why: the DB only learns a device's proxy when it is synced WHILE RUNNING
 * (VMOS `proxy_get` returns nothing on a stopped container). Almost all devices
 * are stopped, so `devices.proxy_enabled` under-counts reality. This script
 * walks every device on every ONLINE box, briefly starts the stopped ones,
 * reads the live proxy config, writes the truth back to Supabase, then stops
 * only the containers it started.
 *
 * Safety:
 *   - box-3 (offline) is excluded (only `boxes.status=online` are audited).
 *   - Devices with a ready/executing campaign job are SKIPPED (never disturb the
 *     automator).
 *   - Already-running devices are read but NOT stopped (never kill an operator
 *     stream / a job).
 *   - Per-box concurrency is capped well under the 10-container host limit.
 *
 * Usage (from Attila V4/):
 *   node scripts/audit-proxy-fleet.mjs                 # audit + repair DB
 *   node scripts/audit-proxy-fleet.mjs --dry-run       # read only, no DB write
 *   node scripts/audit-proxy-fleet.mjs --concurrency 5 # per-box in-flight cap
 */

import {
  fetchDevicesForProxyAudit,
  fetchBusyDeviceIds,
  fetchRomStatus,
  runContainer,
  stopContainer,
  fetchProxyConfig,
  recordDeviceProxy,
} from "./lib/fleet.mjs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const CONCURRENCY = Math.max(1, Number(flag("--concurrency", 6)) || 6);
const BOX_FILTER = flag("--box", null); // substring match on box name, e.g. "box-5"
const LIMIT = flag("--limit", null) ? Number(flag("--limit", null)) : null; // per-box cap
const ONLY_UNPROXIED = args.includes("--only-unproxied"); // re-audit only DB-unproxied

const BOOT_TIMEOUT_MS = 120_000;
const POLL_MS = 2_500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitRomReady(host, dbId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const code = await fetchRomStatus(host, dbId).catch(() => -1);
    if (code === 200) return true;
    await sleep(POLL_MS);
  }
  return false;
}

async function auditDevice(dev) {
  const host = dev.boxes.tunnel_hostname;
  const db = dev.db_id;
  let startedByUs = false;
  try {
    const code = await fetchRomStatus(host, db).catch(() => -1);
    // 200 = ready (read now). 1 = running but not ready (just wait). ANYTHING
    // else (0 = not started, 201 = stopped on some CBS builds, -1 = transient)
    // means "not ready" → attempt a start. Only code 200 is trusted as ready.
    if (code !== 200) {
      if (code !== 1) {
        const resp = await runContainer(host, db).catch((e) => ({ code: -1, err: String(e) }));
        const rc = resp?.code ?? -1;
        if (rc === 200) startedByUs = true;
        else if (rc === 2) { /* already running (not in stopped state) — just wait */ }
        else if (rc === 203) return { ...base(dev), status: "box_full", detail: "run 203 (retry later)" };
        else return { ...base(dev), status: "start_failed", detail: `run code ${rc}` };
      }
      if (!(await waitRomReady(host, db, BOOT_TIMEOUT_MS))) return { ...base(dev), status: "boot_timeout" };
    }

    await sleep(1500); // let cbs settle the mihomo state before reading it
    const cfg = await fetchProxyConfig(host, db).catch(() => null);

    if (cfg && cfg.enabled && cfg.ip) {
      if (!DRY_RUN) await recordDeviceProxy(dev.id, cfg);
      return { ...base(dev), status: "proxied", detail: `${cfg.proxyType} ${cfg.ip}:${cfg.port}` };
    }
    // Genuinely no proxy (config missing or disabled).
    if (!DRY_RUN) await recordDeviceProxy(dev.id, null);
    return { ...base(dev), status: "no_proxy" };
  } catch (err) {
    return { ...base(dev), status: "error", detail: err instanceof Error ? err.message : String(err) };
  } finally {
    if (startedByUs) await stopContainer(host, db).catch(() => {});
  }
}

const base = (dev) => ({ box: dev.boxes.name, name: dev.user_name || dev.db_id });

async function auditBox(boxName, devices, results, counters) {
  let idx = 0;
  const worker = async () => {
    while (idx < devices.length) {
      const dev = devices[idx++];
      const r = await auditDevice(dev);
      results.push(r);
      counters[r.status] = (counters[r.status] ?? 0) + 1;
      counters._done++;
      if (counters._done % 20 === 0) {
        console.log(`  … ${counters._done}/${counters._total} audited (proxied=${counters.proxied ?? 0} no_proxy=${counters.no_proxy ?? 0})`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, devices.length) }, worker));
  console.log(`── ${boxName}: done`);
}

async function main() {
  console.log(`=== FULL fleet proxy audit ${DRY_RUN ? "(DRY RUN — no DB writes)" : "(repairing DB)"} — concurrency ${CONCURRENCY}/box ===`);
  const [devices, busy] = await Promise.all([fetchDevicesForProxyAudit(), fetchBusyDeviceIds()]);

  let auditable = devices.filter((d) => !busy.has(d.id));
  if (BOX_FILTER) auditable = auditable.filter((d) => d.boxes.name.includes(BOX_FILTER));
  // Re-run mode: only revisit devices the DB still shows as unproxied (retries
  // the boot_timeout / box-full misses without re-auditing the whole fleet).
  if (ONLY_UNPROXIED) auditable = auditable.filter((d) => !d.proxy_enabled && d.state !== "removed");
  const skippedBusy = devices.length - devices.filter((d) => !busy.has(d.id)).length;
  console.log(`devices on online boxes: ${devices.length}  ·  auditable: ${auditable.length}  ·  skipped (active job): ${skippedBusy}\n`);

  // Group by box and run boxes in parallel (each box independent + capacity-isolated).
  const byBox = new Map();
  for (const d of auditable) {
    const key = d.boxes.name;
    if (!byBox.has(key)) byBox.set(key, []);
    byBox.get(key).push(d);
  }
  if (LIMIT) for (const [k, v] of byBox) byBox.set(k, v.slice(0, LIMIT));

  const results = [];
  const counters = { _done: 0, _total: [...byBox.values()].reduce((n, v) => n + v.length, 0) };
  await Promise.all([...byBox.entries()].map(([boxName, devs]) => auditBox(boxName, devs, results, counters)));

  // --- report ---------------------------------------------------------------
  console.log("\n=== coverage by box (live truth) ===");
  const boxes = [...new Set(results.map((r) => r.box))].sort();
  for (const box of boxes) {
    const rows = results.filter((r) => r.box === box);
    const proxied = rows.filter((r) => r.status === "proxied").length;
    const noProxy = rows.filter((r) => r.status === "no_proxy").length;
    const errors = rows.filter((r) => ["start_failed", "boot_timeout", "unreachable", "error"].includes(r.status)).length;
    const total = rows.length;
    const pct = total ? Math.round((100 * proxied) / total) : 0;
    console.log(`  ${box.padEnd(22)} proxied ${proxied}/${total} (${pct}%)  ·  no_proxy ${noProxy}  ·  unreadable ${errors}`);
  }

  const proxied = results.filter((r) => r.status === "proxied").length;
  const noProxy = results.filter((r) => r.status === "no_proxy").length;
  const unreadable = results.length - proxied - noProxy;
  console.log("\n=== fleet total ===");
  console.log(`audited ${results.length}  ·  PROXIED ${proxied}  ·  NO PROXY ${noProxy}  ·  unreadable ${unreadable}  ·  skipped(active job) ${skippedBusy}`);

  const noProxyList = results.filter((r) => r.status === "no_proxy").map((r) => `${r.box}/${r.name}`);
  if (noProxyList.length) {
    console.log(`\ndevices WITHOUT a proxy (${noProxyList.length}):`);
    console.log("  " + noProxyList.join(", "));
  }
  const unreadableList = results.filter((r) => ["start_failed", "boot_timeout", "unreachable", "error"].includes(r.status));
  if (unreadableList.length) {
    console.log(`\nunreadable (${unreadableList.length}):`);
    for (const r of unreadableList) console.log(`  ${r.box}/${r.name}: ${r.status} ${r.detail ?? ""}`);
  }
  console.log(DRY_RUN ? "\n(DRY RUN — DB not modified)" : "\n✓ DB proxy columns updated to live truth");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
