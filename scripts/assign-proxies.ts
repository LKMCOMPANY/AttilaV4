#!/usr/bin/env npx tsx
/**
 * Give every device ONE dedicated proxy in its persona's country, through the
 * one proxy profile (`proxySetPayload`: host-side engine, UDP off, DNS through
 * the proxy), and prove it on the same boot.
 *
 * Input: a CSV of proxies, one per line, header required:
 *
 *   country,host,port,username,password[,city]
 *   US,isp.oxylabs.io,8001,user-cc-US,secret,Boston
 *
 * Plan (`--dry-run` prints it and stops): devices on ONLINE boxes, not
 * removed, ordered by user_name; the persona's country is `devices.country`
 * else the `user_name` prefix (FR90 → FR); each device takes the next unused
 * proxy of its country. A device whose country has no proxy left is listed,
 * not touched. `--box`, `--names` and `--countries` narrow the run.
 *
 * Apply, per device, two in flight per box: boot → `proxy_set` (product code:
 * `setProxyConfig`, tunnel) → `/proxy-test` + exit geo from the guest → mirror
 * `devices.proxy_*` → stop (only what we started). A device whose exit is not
 * in the persona's country is reported as MISMATCH and keeps the new proxy
 * (the list is the truth to fix, not the device). Never logs a password.
 *
 * The CSV reading and the assignment are pure (`scripts/lib/proxy-assignment.mjs`,
 * tested); this file boots, writes and verifies.
 *
 * Usage (from Attila V4/):
 *   npx tsx scripts/assign-proxies.ts --csv proxies.csv --dry-run
 *   npx tsx scripts/assign-proxies.ts --csv proxies.csv --box box-3.attila.army
 *   npx tsx scripts/assign-proxies.ts --csv proxies.csv --names US30,FR22 --report out.json
 */

import { readFile, writeFile } from "node:fs/promises";
import {
  fetchBusyDeviceIds,
  fetchDevicesOnOnlineBoxes,
  fetchRunningDbIds,
  mapWithConcurrency,
  runContainer,
  shell,
  sleep,
  stopContainer,
} from "./lib/fleet.mjs";
import { probeRouting, readProxyConfig } from "./lib/proxy-probe.mjs";
import { parseProxyCsv, planAssignments } from "./lib/proxy-assignment.mjs";
import { expectedCountry } from "./lib/proxy-verdict.mjs";
import { loadDotEnvLocal } from "./lib/dotenv.mjs";

type ProxyRow = ReturnType<typeof parseProxyCsv>[number];

interface DeviceRow {
  id: string;
  db_id: string;
  user_name: string | null;
  state: string;
  country?: string | null;
  proxy_enabled: boolean | null;
  boxes: { name: string; tunnel_hostname: string; status: string };
}

interface Assignment {
  device: DeviceRow;
  proxy: ProxyRow | null;
  country: string | null;
}

const STARTS_IN_FLIGHT_PER_BOX = 2;
const BOOT_TIMEOUT_MS = 120_000;

function parseArgs(argv: string[]) {
  const args = { csv: "", dryRun: false, box: null as string | null, names: null as Set<string> | null, countries: null as Set<string> | null, report: null as string | null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--csv") args.csv = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--box") args.box = argv[++i];
    else if (a === "--names") args.names = new Set(argv[++i].split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--countries") args.countries = new Set(argv[++i].split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
    else if (a === "--report") args.report = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.csv) throw new Error("--csv <file> is required");
  return args;
}

async function waitBooted(host: string, dbId: string): Promise<boolean> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(5000);
    const r = await shell(host, dbId, "getprop sys.boot_completed").catch(() => ({ ok: false, message: "" }));
    if (r.ok && r.message.trim() === "1") return true;
  }
  return false;
}

interface ApplyResult {
  box: string;
  user_name: string | null;
  db_id: string;
  country: string | null;
  proxy: string;
  result: "OK" | "MISMATCH" | "boot_timeout" | "error" | string;
  configured?: string;
  routing?: string;
  exit?: string | null;
  error?: string;
}

async function applyOne(a: Assignment & { proxy: ProxyRow }, alreadyRunning: Set<string>): Promise<ApplyResult> {
  const { setProxyConfig } = await import("../src/lib/box-api");
  const host = a.device.boxes.tunnel_hostname;
  const dbId = a.device.db_id;
  const startedByUs = !alreadyRunning.has(dbId);
  const out = { box: a.device.boxes.name, user_name: a.device.user_name, db_id: dbId, country: a.country, proxy: `${a.proxy.host}:${a.proxy.port}` };
  try {
    if (startedByUs) {
      await runContainer(host, dbId);
      if (!(await waitBooted(host, dbId))) return { ...out, result: "boot_timeout" };
    }
    await setProxyConfig(host, dbId, { proxyType: "socks5", ip: a.proxy.host, port: a.proxy.port, account: a.proxy.username, password: a.proxy.password });
    await sleep(2000);
    const config = await readProxyConfig(host, a.device);
    const routing = await probeRouting(host, { ...a.device, state: "running" }, { geo: true });
    const exit = routing.geo?.exit ?? null;
    const result = routing.tag !== "ROUTES" ? routing.tag : routing.geo && !routing.geo.coherent ? "MISMATCH" : "OK";
    return { ...out, result, configured: config.status, routing: `${routing.tag} ${routing.detail}`, exit: exit ? `${exit.country}/${exit.city ?? "?"} ${exit.ip}` : null };
  } catch (err) {
    return { ...out, result: "error", error: err instanceof Error ? err.message.slice(0, 120) : String(err) };
  } finally {
    if (startedByUs) await stopContainer(host, dbId).catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv);
  loadDotEnvLocal();
  const proxies = parseProxyCsv(await readFile(args.csv, "utf8"));

  const [all, busy] = await Promise.all([fetchDevicesOnOnlineBoxes() as Promise<DeviceRow[]>, fetchBusyDeviceIds()]);
  let devices = all.filter((d) => d.state !== "removed" && !busy.has(d.id));
  if (args.box) devices = devices.filter((d) => d.boxes.tunnel_hostname === args.box);
  if (args.names) devices = devices.filter((d) => args.names!.has(d.user_name ?? ""));
  if (args.countries) devices = devices.filter((d) => args.countries!.has(expectedCountry(d) ?? ""));

  const { assignments, spare, short } = planAssignments(devices, proxies);
  const planned = assignments.filter((a): a is Assignment & { proxy: ProxyRow } => a.proxy !== null);
  const unplanned = assignments.filter((a) => a.proxy === null);

  console.log(`=== proxy assignment — ${proxies.length} proxies in the list, ${devices.length} device(s) in scope ===`);
  console.log(`planned ${planned.length} · without a proxy for their country ${unplanned.length} · spare ${JSON.stringify(spare)} · short ${JSON.stringify(short)}`);
  if (unplanned.length) console.log(`  unplanned: ${unplanned.map((a) => `${a.device.boxes.name}/${a.device.user_name ?? a.device.db_id} (${a.country ?? "no country"})`).join(", ")}`);
  if (args.dryRun) {
    for (const a of planned) console.log(`  ${a.device.boxes.name}/${(a.device.user_name ?? a.device.db_id).padEnd(8)} ${a.country} ← ${a.proxy.host}:${a.proxy.port}${a.proxy.city ? ` (${a.proxy.city})` : ""}`);
    return;
  }

  // Per box, two in flight; boxes in parallel (each has its own ceiling).
  const byBox = new Map<string, (Assignment & { proxy: ProxyRow })[]>();
  for (const a of planned) {
    const host = a.device.boxes.tunnel_hostname;
    if (!byBox.has(host)) byBox.set(host, []);
    byBox.get(host)!.push(a);
  }
  const results: ApplyResult[] = [];
  await Promise.all(
    [...byBox.entries()].map(async ([host, list]) => {
      const alreadyRunning = await fetchRunningDbIds(host).catch(() => new Set<string>());
      const rows = await mapWithConcurrency(list, STARTS_IN_FLIGHT_PER_BOX, async (a: Assignment & { proxy: ProxyRow }) => {
        const r = await applyOne(a, alreadyRunning);
        console.log(`  ${r.box.padEnd(6)} ${(r.user_name ?? r.db_id).padEnd(8)} ${r.result.padEnd(12)} ${r.exit ?? r.error ?? ""}`);
        return r;
      });
      results.push(...rows);
    }),
  );

  const tally = results.reduce<Record<string, number>>((acc, r) => ((acc[r.result] = (acc[r.result] ?? 0) + 1), acc), {});
  console.log(`\n=== summary === ${JSON.stringify(tally)}`);
  if (args.report) {
    await writeFile(args.report, JSON.stringify(results, null, 2));
    console.log(`report written: ${args.report}`);
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
