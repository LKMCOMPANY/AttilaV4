#!/usr/bin/env node
/**
 * Boot-health sweep — the only honest answer to "how many devices actually work".
 *
 * `list_names` reporting `state: running` says a container process exists, not
 * that Android came up. On box-1, 44 of 96 containers carried an ext4 error flag
 * after the host filled to 98%; the offline maintenance pass cleared them, but a
 * share still stall on the boot animation. The difference only shows if you boot
 * them, so this script does, in batches, and records a verdict per device:
 *
 *   healthy   reached `sys.boot_completed=1` within the timeout
 *   unstable  reached it, then the container died under us (crash loop)
 *   dead      never reached it
 *
 * Safety contract:
 *   - never boots a device already recorded `dead` unless `--recheck` asks for
 *     it: a dead device booted sits in VMOS `starting`, crash-looping, which
 *     `stop` refuses for hours and which costs the host ~3 load points each
 *     (box-1, 26 September 2026: five of them, load 14.8, zero useful work);
 *   - never touches a device with a ready/executing campaign job;
 *   - never exceeds the VMOS ceiling of 10 running containers per box, counting
 *     what is ALREADY running (an operator may be streaming);
 *   - stops only what it started, so a device someone else is using stays up.
 *
 * With `--with-proxy` the same boot also answers the proxy questions while the
 * device is up (one boot instead of three sweeps): the configured proxy is
 * mirrored into the DB (`readProxyConfig`), then routing and exit geo are
 * probed (`probeRouting`). `--report <path>` writes the per-device rows as JSON.
 *
 * Usage:
 *   node scripts/audit-device-health.mjs --box box-1.attila.army
 *   node scripts/audit-device-health.mjs --all --concurrency 2 --with-proxy
 *   node scripts/audit-device-health.mjs --box box-1.attila.army --dry-run
 *   node scripts/audit-device-health.mjs --box box-3.attila.army --names US30,FR22 --with-proxy
 */

import {
  fetchDevicesWithBoxes,
  fetchBusyDeviceIds,
  fetchRunningDbIds,
  runContainer,
  stopContainer,
  shell,
  recordDeviceBootHealth,
  mapWithConcurrency,
  sleep,
} from "./lib/fleet.mjs";
import { describeRouting, probeRouting, readProxyConfig } from "./lib/proxy-probe.mjs";
import { writeFile } from "node:fs/promises";

// Android on these images boots in ~20-45s when healthy. 120s matches the
// pipeline's own `ensureContainerReady` ceiling, so a device this sweep calls
// dead is exactly a device the pipeline would fail on.
const BOOT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 5_000;
// After boot_completed, watch a moment longer: a crash-looping container reports
// success and then dies. That is `unstable`, not `healthy`.
const STABILITY_WATCH_MS = 20_000;
const VMOS_MAX_RUNNING_PER_BOX = 10;
// Boots contend for the host: median healthy boot 22–24 s alone against 93 s
// at concurrency 9, which pushes healthy devices past the ceiling. Two cold
// starts in flight per box is the fleet rule (box-slots.ts MAX_STARTS_IN_FLIGHT)
// and the default here; `--concurrency` overrides it knowingly.
const DEFAULT_STARTS_IN_FLIGHT = 2;

function parseArgs(argv) {
  const args = {
    box: null, all: false, concurrency: null, dryRun: false, recheck: false, withProxy: false, report: null, names: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--box") args.box = argv[++i];
    else if (a === "--all") args.all = true;
    else if (a === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--recheck") args.recheck = true;
    else if (a === "--with-proxy") args.withProxy = true;
    else if (a === "--report") args.report = argv[++i];
    // `--names US30,FR22`: only these user_names (re-probe a subset after a fix).
    else if (a === "--names") args.names = new Set(argv[++i].split(",").map((n) => n.trim()).filter(Boolean));
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  if (!args.box && !args.all) {
    console.error("Specify --box <tunnel_hostname> or --all");
    process.exit(1);
  }
  return args;
}

async function readBootCompleted(boxHost, dbId) {
  try {
    const res = await shell(boxHost, dbId, "getprop sys.boot_completed");
    return res.ok && res.message.trim() === "1";
  } catch {
    // The container can vanish mid-poll (crash loop) — that is data, not an error.
    return false;
  }
}

/**
 * Boot one device and classify it. Returns `{ health, bootMs }` and leaves the
 * container stopped if we were the ones who started it.
 */
async function probeDevice(boxHost, device, { withProxy = false } = {}) {
  const { db_id: dbId } = device;
  const startedAt = Date.now();

  try {
    await runContainer(boxHost, dbId);
  } catch (err) {
    // VMOS refuses to start an instance stuck in `starting` — that is a dead one.
    return { health: "dead", bootMs: null, note: `run refused: ${short(err)}` };
  }

  let bootMs = null;
  while (Date.now() - startedAt < BOOT_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    if (await readBootCompleted(boxHost, dbId)) {
      bootMs = Date.now() - startedAt;
      break;
    }
  }

  if (bootMs === null) {
    await stopQuietly(boxHost, dbId);
    return { health: "dead", bootMs: null, note: `no boot_completed in ${BOOT_TIMEOUT_MS / 1000}s` };
  }

  // The device is up: ask the proxy questions now, while it can answer them.
  // Also the stability watch — these probes take a few seconds, so only the
  // remainder of the window is slept.
  const probesStartedAt = Date.now();
  const proxy = withProxy ? await probeProxyWhileUp(boxHost, device) : undefined;

  // Still alive a moment later? Then it is genuinely up, not crash-looping.
  await sleep(Math.max(0, STABILITY_WATCH_MS - (Date.now() - probesStartedAt)));
  const stillUp = await readBootCompleted(boxHost, dbId);
  await stopQuietly(boxHost, dbId);

  return stillUp
    ? { health: "healthy", bootMs, note: null, proxy }
    : { health: "unstable", bootMs, note: "booted then died within the stability window", proxy };
}

/**
 * Configured proxy (mirrored to the DB) + routing + exit geo, on a device that
 * has just reached boot_completed. Returns `{ config, routing }` where
 * `routing` is null when nothing is configured.
 */
async function probeProxyWhileUp(boxHost, device) {
  const config = await readProxyConfig(boxHost, device).catch((err) => ({ status: "error", detail: short(err) }));
  const routing = config.status === "proxied"
    ? await probeRouting(boxHost, { ...device, state: "running" }, { geo: true }).catch((err) => ({ tag: "FAIL", detail: short(err) }))
    : null;
  return { config, routing };
}

function describeProxy(proxy) {
  if (!proxy) return "";
  if (proxy.config.status !== "proxied") return `  proxy: ${proxy.config.status}`;
  return `  proxy: ${proxy.config.detail} ${describeRouting(proxy.routing)}`;
}

async function stopQuietly(boxHost, dbId) {
  try {
    await stopContainer(boxHost, dbId);
  } catch {
    /* already gone, or VMOS refuses because it is not running — either is fine */
  }
}

function short(err) {
  return (err instanceof Error ? err.message : String(err)).slice(0, 120);
}

async function sweepBox(boxHost, devices, { concurrency, dryRun, withProxy }) {
  console.log(`\n=== ${boxHost} — ${devices.length} device(s) ===`);

  let alreadyRunning;
  try {
    alreadyRunning = await fetchRunningDbIds(boxHost);
  } catch (err) {
    console.error(`  box unreachable, skipped: ${short(err)}`);
    return [];
  }

  // Whatever is already up belongs to someone else. Leave it alone and shrink
  // our budget accordingly.
  const targets = devices.filter((d) => !alreadyRunning.has(d.db_id));
  const budget = Math.max(0, VMOS_MAX_RUNNING_PER_BOX - alreadyRunning.size);
  const limit = Math.max(1, Math.min(concurrency ?? DEFAULT_STARTS_IN_FLIGHT, budget));

  if (alreadyRunning.size > 0) {
    console.log(`  ${alreadyRunning.size} already running (left untouched) → budget ${budget}`);
  }
  if (budget === 0) {
    console.log("  box is at the running ceiling — nothing to do");
    return [];
  }
  if (dryRun) {
    console.log(`  [dry-run] would boot ${targets.length} device(s), ${limit} at a time`);
    return [];
  }

  let done = 0;
  const first = await mapWithConcurrency(targets, limit, async (device) => {
    const verdict = await probeDevice(boxHost, device, { withProxy });
    done++;
    const ms = verdict.bootMs ? `${(verdict.bootMs / 1000).toFixed(0)}s` : "—";
    console.log(
      `  [${String(done).padStart(3)}/${targets.length}] ${device.db_id} ` +
        `${(device.user_name ?? "").padEnd(6)} ${verdict.health.padEnd(8)} ${ms}` +
        (verdict.note ? `  (${verdict.note})` : "") +
        describeProxy(verdict.proxy),
    );
    return { boxHost, device, ...verdict };
  });

  // Second pass, SERIAL. Concurrent boots contend for the same host: a device
  // that comes up in ~22 s alone can take past the 120 s ceiling with eight
  // siblings booting beside it, which the first pass would call dead. Measured
  // on box-1: median healthy boot 22 s alone against 93 s at concurrency 9.
  // Nothing is declared dead until it has failed on its own. Skipped when the
  // first pass was already serial — it would just repeat itself.
  const suspects = limit > 1 ? first.filter((r) => r.health !== "healthy") : [];
  if (suspects.length) {
    console.log(`  — re-probing ${suspects.length} non-healthy device(s) serially —`);
    for (const [i, suspect] of suspects.entries()) {
      const verdict = await probeDevice(boxHost, suspect.device, { withProxy });
      Object.assign(suspect, verdict);
      const ms = verdict.bootMs ? `${(verdict.bootMs / 1000).toFixed(0)}s` : "—";
      console.log(
        `  [retry ${String(i + 1).padStart(3)}/${suspects.length}] ${suspect.device.db_id} ` +
          `${(suspect.device.user_name ?? "").padEnd(6)} ${verdict.health.padEnd(8)} ${ms}`,
      );
    }
  }

  // Persist once, after the verdict is final.
  for (const row of first) {
    await recordDeviceBootHealth(row.device.id, { health: row.health, bootMs: row.bootMs });
  }
  return first;
}

async function main() {
  const args = parseArgs(process.argv);

  const [devices, busy] = await Promise.all([fetchDevicesWithBoxes(), fetchBusyDeviceIds()]);
  const knownDead = [];

  const eligible = devices.filter((d) => {
    if (!d.db_id || !d.boxes?.tunnel_hostname) return false;
    // Ghost rows (no container on the box) would each burn the full boot
    // timeout for nothing — reconcile-devices.mjs flags them `removed`.
    if (d.state === "removed") return false;
    if (args.box && d.boxes.tunnel_hostname !== args.box) return false;
    // `--recheck`: only the devices a previous sweep could not clear. Pair it
    // with `--concurrency 1` to get a contention-free verdict. Without it a
    // known-dead device is left alone (see the safety contract above).
    if (args.recheck && d.boot_health === "healthy") return false;
    if (!args.recheck && d.boot_health === "dead") { knownDead.push(d); return false; }
    if (args.names && !args.names.has(d.user_name ?? "")) return false;
    return true;
  });

  const skippedBusy = eligible.filter((d) => busy.has(d.id));
  const workable = eligible.filter((d) => !busy.has(d.id));

  console.log("=== device boot-health sweep ===");
  console.log(`devices in scope : ${eligible.length}`);
  if (knownDead.length) {
    console.log(`known dead, left alone (--recheck to re-probe): ${knownDead.length} — ${knownDead.map((d) => d.user_name ?? d.db_id).join(", ")}`);
  }
  if (skippedBusy.length) {
    console.log(`skipped (job due): ${skippedBusy.length} — ${skippedBusy.map((d) => d.db_id).join(", ")}`);
  }

  const byBox = new Map();
  for (const d of workable) {
    const host = d.boxes.tunnel_hostname;
    if (!byBox.has(host)) byBox.set(host, []);
    byBox.get(host).push(d);
  }

  const results = [];
  // Boxes sequentially: each one's ceiling is independent, but a serial sweep
  // keeps the log readable and the tunnel unstressed.
  for (const [host, list] of [...byBox].sort()) {
    results.push(...(await sweepBox(host, list, args)));
  }

  if (args.report) {
    await writeFile(
      args.report,
      JSON.stringify(
        results.map((r) => ({
          box: r.boxHost, db_id: r.device.db_id, user_name: r.device.user_name ?? null,
          health: r.health, boot_ms: r.bootMs, note: r.note ?? null, proxy: r.proxy ?? null,
        })),
        null,
        2,
      ),
    );
    console.log(`\nreport written: ${args.report}`);
  }

  if (!results.length) return;

  const tally = results.reduce((acc, r) => {
    acc[r.health] = (acc[r.health] ?? 0) + 1;
    return acc;
  }, {});
  const healthy = results.filter((r) => r.health === "healthy");
  const median = healthy.length
    ? healthy.map((r) => r.bootMs).sort((a, b) => a - b)[Math.floor(healthy.length / 2)]
    : null;

  console.log("\n=== summary ===");
  console.log(`probed   : ${results.length}`);
  console.log(`healthy  : ${tally.healthy ?? 0}`);
  console.log(`unstable : ${tally.unstable ?? 0}`);
  console.log(`dead     : ${tally.dead ?? 0}`);
  if (median) console.log(`median boot (healthy): ${(median / 1000).toFixed(0)}s`);

  const broken = results.filter((r) => r.health !== "healthy");
  if (broken.length) {
    console.log("\nnot usable:");
    for (const r of broken) {
      console.log(`  ${r.device.db_id} ${(r.device.user_name ?? "").padEnd(6)} ${r.health}  ${r.note ?? ""}`);
    }
  }

  if (args.withProxy) summarizeProxies(results);
}

function summarizeProxies(results) {
  const probed = results.filter((r) => r.proxy);
  const noProxy = probed.filter((r) => r.proxy.config.status === "no_proxy");
  const unproxied = probed.filter((r) => r.proxy.routing?.tag === "UNPROXIED");
  const down = probed.filter((r) => r.proxy.routing && !["ROUTES", "UNPROXIED"].includes(r.proxy.routing.tag));
  const geoChecked = probed.filter((r) => r.proxy.routing?.geo?.exit);
  const mismatched = geoChecked.filter((r) => !r.proxy.routing.geo.coherent);
  console.log("\n=== proxies (same boot) ===");
  console.log(`config read: ${probed.length}   no proxy: ${noProxy.length}   UNPROXIED: ${unproxied.length}   not routing: ${down.length}   geo checked: ${geoChecked.length}   geo mismatch: ${mismatched.length}`);
  const line = (r) => `  ${r.boxHost.split(".")[0]}/${r.device.user_name ?? r.device.db_id}`;
  if (noProxy.length) console.log(`\nwithout a proxy (${noProxy.length}):\n${noProxy.map(line).join("\n")}`);
  if (unproxied.length) console.log(`\nUNPROXIED — leaves through the box's own address (${unproxied.length}):\n${unproxied.map((r) => `${line(r)}  ${r.proxy.routing.geo?.exit?.ip ?? ""}`).join("\n")}`);
  if (down.length) console.log(`\nnot routing (${down.length}):\n${down.map((r) => `${line(r)}  ${r.proxy.routing.tag} ${r.proxy.routing.detail}`).join("\n")}`);
  if (mismatched.length) {
    console.log(`\ngeo mismatch (${mismatched.length}):`);
    for (const r of mismatched) {
      const g = r.proxy.routing.geo;
      console.log(`${line(r)}  expected ${g.expected}, exits ${g.exit.country}/${g.exit.city ?? "?"}`);
    }
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
