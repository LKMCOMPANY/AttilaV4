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
 * proxy of its country. A proxy another device (on an online box) already
 * holds is never handed out — a dedicated IP shared by two devices ties two
 * accounts together. A device whose country has no proxy left is listed, not
 * touched. `--box`, `--names` and `--countries` narrow the run; names are
 * NOT unique across boxes (US100 lives on box-3 and box-4), so a name may be
 * box-qualified: `--names box-3:US100,GB3`.
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
 * `--reapply` takes no list: every device that already holds a proxy (the DB
 * mirror) is written again with its own upstream — same host, port and
 * credentials — so it runs on the one profile (host engine, UDP off, DNS
 * through the exit) without changing its IP. `--provider nodemaven` narrows
 * it to one upstream host.
 *
 * Usage (from Attila V4/):
 *   npx tsx scripts/assign-proxies.ts --csv proxies.csv --dry-run
 *   npx tsx scripts/assign-proxies.ts --csv proxies.csv --box box-3.attila.army
 *   npx tsx scripts/assign-proxies.ts --csv proxies.csv --names US30,FR22 --report out.json
 *   npx tsx scripts/assign-proxies.ts --reapply --provider nodemaven --box box-2.attila.army
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
import { parseProxyCsv, planAssignments, proxyKey } from "./lib/proxy-assignment.mjs";
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
  proxy_type?: string | null;
  proxy_host?: string | null;
  proxy_port?: number | null;
  proxy_account?: string | null;
  proxy_password?: string | null;
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
  const args = {
    csv: "", dryRun: false, reapply: false, provider: null as string | null,
    box: null as string | null, names: null as Set<string> | null, countries: null as Set<string> | null, report: null as string | null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--csv") args.csv = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--box") args.box = argv[++i];
    else if (a === "--names") args.names = new Set(argv[++i].split(",").map((s) => s.trim()).filter(Boolean));
    // each entry is `NAME` (any box) or `box-N:NAME`
    else if (a === "--countries") args.countries = new Set(argv[++i].split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
    else if (a === "--report") args.report = argv[++i];
    else if (a === "--reapply") args.reapply = true;
    else if (a === "--provider") args.provider = argv[++i].toLowerCase();
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.csv && !args.reapply) throw new Error("--csv <file> or --reapply is required");
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

/** cbs_go forwards proxy calls to a service inside the guest (port 18183) that comes up a few seconds after boot_completed. */
async function waitProxyService(host: string, dbId: string, fetchProxyConfig: (h: string, id: string) => Promise<unknown>): Promise<boolean> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await fetchProxyConfig(host, dbId).catch(() => null)) return true;
    await sleep(3000);
  }
  return false;
}

async function applyOne(a: Assignment & { proxy: ProxyRow }, alreadyRunning: Set<string>): Promise<ApplyResult> {
  const { setProxyConfig, fetchProxyConfig } = await import("../src/lib/box-api");
  const host = a.device.boxes.tunnel_hostname;
  const dbId = a.device.db_id;
  const startedByUs = !alreadyRunning.has(dbId);
  const out = { box: a.device.boxes.name, user_name: a.device.user_name, db_id: dbId, country: a.country, proxy: `${a.proxy.host}:${a.proxy.port}` };
  try {
    if (startedByUs) {
      await runContainer(host, dbId);
      if (!(await waitBooted(host, dbId))) return { ...out, result: "boot_timeout" };
    }
    if (!(await waitProxyService(host, dbId, fetchProxyConfig))) return { ...out, result: "proxy_service_timeout" };
    await setProxyConfig(host, dbId, { proxyType: "socks5", ip: a.proxy.host, port: a.proxy.port, account: a.proxy.username, password: a.proxy.password });
    // cbs_go acknowledges before the engine has reloaded: `proxy_get` can still
    // answer the previous upstream for a few seconds (US32, 26 Sep 2026 — the
    // mirror then kept the old port and the next plan handed its new one to
    // another device). Read back until the device reports what we wrote.
    let config = await readProxyConfig(host, a.device, { dryRun: true });
    for (let attempt = 0; attempt < 5 && !(config.cfg?.ip === a.proxy.host && Number(config.cfg?.port) === a.proxy.port); attempt++) {
      await sleep(3000);
      config = await readProxyConfig(host, a.device, { dryRun: true });
    }
    if (!(config.cfg?.ip === a.proxy.host && Number(config.cfg?.port) === a.proxy.port)) {
      return { ...out, result: "set_not_applied", configured: config.detail };
    }
    config = await readProxyConfig(host, a.device); // now mirrored to the DB
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

/** `--reapply`: each device's own upstream, from the DB mirror, as the proxy to write. */
function reapplyPlan(devices: DeviceRow[]) {
  const assignments = devices.map((device) => {
    const complete = device.proxy_host && device.proxy_port && device.proxy_account && device.proxy_password;
    const proxy: ProxyRow | null = complete
      ? { country: expectedCountry(device) ?? "??", host: device.proxy_host!, port: device.proxy_port!, username: device.proxy_account!, password: device.proxy_password!, city: undefined }
      : null;
    return { device, proxy, country: expectedCountry(device) };
  });
  return { assignments, spare: {}, short: {}, reserved: 0 };
}

async function main() {
  const args = parseArgs(process.argv);
  loadDotEnvLocal();
  const proxies = args.csv ? parseProxyCsv(await readFile(args.csv, "utf8")) : [];

  const [all, busy] = await Promise.all([fetchDevicesOnOnlineBoxes() as Promise<DeviceRow[]>, fetchBusyDeviceIds()]);
  let devices = all.filter((d) => d.state !== "removed" && !busy.has(d.id));
  if (args.box) devices = devices.filter((d) => d.boxes.tunnel_hostname === args.box);
  if (args.names) {
    const wanted = args.names;
    const short = (d: DeviceRow) => d.boxes.tunnel_hostname.split(".")[0];
    devices = devices.filter((d) => wanted.has(d.user_name ?? "") || wanted.has(`${short(d)}:${d.user_name ?? ""}`));
  }
  if (args.countries) devices = devices.filter((d) => args.countries!.has(expectedCountry(d) ?? ""));
  if (args.provider) devices = devices.filter((d) => (d.proxy_host ?? "").toLowerCase().includes(args.provider!));

  // Proxies already held by a device on an online box (the DB mirror) — the
  // holder keeps it, nobody else gets it.
  const reserved = new Map<string, string>();
  for (const d of all) if (d.state !== "removed" && d.proxy_host && d.proxy_port) reserved.set(proxyKey(d.proxy_host, d.proxy_port), d.id);

  const { assignments, spare, short, reserved: withheld } = args.reapply
    ? reapplyPlan(devices)
    : planAssignments(devices, proxies, { reserved });
  const planned = assignments.filter((a): a is Assignment & { proxy: ProxyRow } => a.proxy !== null);
  const unplanned = assignments.filter((a) => a.proxy === null);

  console.log(`=== proxy assignment — ${proxies.length} proxies in the list, ${devices.length} device(s) in scope ===`);
  console.log(`planned ${planned.length} · without a proxy for their country ${unplanned.length} · withheld (held by another device) ${withheld} · spare ${JSON.stringify(spare)} · short ${JSON.stringify(short)}`);
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
