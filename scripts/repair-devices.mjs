/**
 * Repair devices that fail to provision — targeted device management.
 *
 * For each --only db_id (or user_name):
 *   1. run + wait for rom_status (the box may simply have been busy earlier);
 *   2. once booted, check internet reachability; if it fails, run the mihomo
 *      proxy-test to confirm a dead/absent proxy — reported, NOT auto-changed
 *      (choosing a replacement proxy is an operator decision);
 *   3. with --recreate: for instances that still won't reach ROM-ready, try
 *      recreate_container (rebuilds from the DB record, PRESERVING data). Note
 *      this does NOT fix a corrupt data volume or a bad ROM image — those need
 *      upgrade_image or a data reset, which are destructive/operator calls.
 *
 * DEFAULT IS NON-MUTATING (diagnose + gentle boot only). Leaves devices stopped.
 *
 * Usage:
 *   node scripts/repair-devices.mjs --only EDGE...,EDGE...            # diagnose
 *   node scripts/repair-devices.mjs --only EDGE...,EDGE... --recreate # + rebuild stuck
 */

import {
  shell,
  fetchDevicesWithBoxes,
  fetchRomStatus,
  runContainer,
  stopContainer,
  recreateContainer,
  proxyTest,
} from "./lib/fleet.mjs";

const ROM_TIMEOUT_MS = 150_000;
const ROM_POLL_MS = 3000;
const CONCURRENCY = 3;
const RECREATE = process.argv.includes("--recreate"); // opt-in mutation

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitRomReady(host, dbId, timeoutMs = ROM_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await fetchRomStatus(host, dbId).catch(() => -1)) === 200) return true;
    await sleep(ROM_POLL_MS);
  }
  return false;
}

async function hasInternet(host, dbId) {
  const r = await shell(
    host,
    dbId,
    "curl -sI -o /dev/null -w '%{http_code}' --max-time 8 https://github.com",
  ).catch(() => null);
  const code = (r?.message || "").trim();
  return code.startsWith("2") || code.startsWith("3");
}

async function repair(device) {
  const host = device.boxes?.tunnel_hostname;
  const dbId = device.db_id;
  const name = device.user_name || dbId;
  const log = (m) => console.log(`[${name.padEnd(16)}] ${m}`);
  const result = { name, dbId, category: "", detail: "", recreated: false };

  if (!host) return { ...result, category: "error", detail: "no box host" };

  try {
    log("run + wait rom_status…");
    await runContainer(host, dbId);
    let ready = await waitRomReady(host, dbId);

    if (!ready && RECREATE) {
      log("won't reach ROM-ready → recreate_container (data preserved) → run");
      await stopContainer(host, dbId).catch(() => {});
      await sleep(3000);
      await recreateContainer(host, dbId);
      await sleep(3000);
      await runContainer(host, dbId);
      ready = await waitRomReady(host, dbId);
      result.recreated = true;
    }

    if (!ready) {
      result.category = "wont_boot";
      result.detail = result.recreated
        ? "ROM never ready even after recreate → needs upgrade_image or data reset (operator)"
        : "ROM never ready (container runs, Android stuck) → rerun with --recreate or upgrade_image";
    } else if (await hasInternet(host, dbId)) {
      result.category = result.recreated ? "recovered_recreate" : "recovered_boot";
      result.detail = "boots + internet OK → ready to provision";
    } else {
      const pt = await proxyTest(host, dbId);
      result.category = "network_dead";
      result.detail = `boots but no internet — proxy-test: ${JSON.stringify(pt)}`;
    }
  } catch (err) {
    result.category = "error";
    result.detail = err instanceof Error ? err.message : String(err);
  } finally {
    await stopContainer(host, dbId).catch(() => {});
  }

  console.log(`[${name.padEnd(16)}] => ${result.category} — ${result.detail}`);
  return result;
}

async function runPool(items, size, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, size) }, worker));
  return out;
}

async function main() {
  const onlyIdx = process.argv.indexOf("--only");
  if (onlyIdx < 0 || !process.argv[onlyIdx + 1]) {
    console.error("usage: node scripts/repair-devices.mjs --only DBID1,DBID2");
    process.exit(1);
  }
  const ids = new Set(process.argv[onlyIdx + 1].split(",").map((s) => s.trim()));
  const all = await fetchDevicesWithBoxes();
  const targets = all.filter((d) => ids.has(d.db_id) || ids.has(d.user_name));
  console.log(`Repairing ${targets.length} device(s) at concurrency ${CONCURRENCY}\n`);

  const results = await runPool(targets, CONCURRENCY, repair);

  console.log("\n=== summary ===");
  for (const c of ["recovered_boot", "recovered_recreate", "network_dead", "wont_boot", "error"]) {
    const list = results.filter((r) => r.category === c).map((r) => r.name);
    if (list.length) console.log(`${c.padEnd(20)}: ${list.length}  [${list.join(", ")}]`);
  }
  const ready = results.filter((r) => r.category.startsWith("recovered")).map((r) => r.dbId);
  if (ready.length) {
    console.log(`\nReady to provision — re-run install with:\n  --only ${ready.join(",")}`);
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
