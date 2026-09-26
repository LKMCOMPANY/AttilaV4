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
 * removed, not recorded `dead` by the health sweep (a dead device booted sits
 * in `starting` for hours), ordered by user_name; the persona's country is `devices.country`
 * else the `user_name` prefix (FR90 → FR); each device takes the next unused
 * proxy of its country. A proxy another device already holds — on ANY box,
 * offline ones included — is never handed out: a dedicated IP shared by two
 * devices ties two accounts together. `--reclaim-offline` releases the
 * CONTESTED proxies held by devices of OFFLINE boxes (a list re-purposed from
 * a box that will be re-provisioned before it ever starts again) and says how
 * many; `--reclaim-from <box>` does the same for one named box whatever its
 * status (box-5 back online on 26 September 2026, its 100 rows still on the
 * ports the online fleet had taken over). Contested means the same host:port
 * on another device too: the holder outside the reclaimed scope keeps it,
 * else the first by name; a port the reclaimed box holds alone stays its own.
 * A device whose country has no proxy left is listed, not touched. `--box`,
 * `--names` and `--countries` narrow the run; names are NOT unique across
 * boxes (US100 lives on box-3 and box-4), so a name may be box-qualified:
 * `--names box-3:US100,GB3`.
 *
 * Apply, per device, two in flight per box: boot → `proxy_set` (product code:
 * `setProxyConfig`, tunnel) → read back until the device reports the written
 * upstream → **restart** (a running host engine leaves the guest without or
 * outside its proxy after a write until the next boot — measured 26 September
 * 2026, ES38 / DE20 exiting through the box for the seconds in between) →
 * `/proxy-test` + exit on the fresh boot → mirror `devices.proxy_*` → stop
 * (only what we started). A device whose exit is not in the persona's
 * country is reported as MISMATCH and keeps the new proxy (the list is the
 * truth to fix, not the device). Never logs a password.
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
 *   npx tsx scripts/assign-proxies.ts --csv proxies.csv --reclaim-offline --dry-run
 *   npx tsx scripts/assign-proxies.ts --csv proxies.csv --box box-5.attila.army --reclaim-from box-5.attila.army
 *   npx tsx scripts/assign-proxies.ts --csv proxies.csv --box box-3.attila.army
 *   npx tsx scripts/assign-proxies.ts --csv proxies.csv --names US30,FR22 --report out.json
 *   npx tsx scripts/assign-proxies.ts --reapply --provider nodemaven --box box-2.attila.army
 */

import { readFile, writeFile } from "node:fs/promises";
import {
  fetchBusyDeviceIds,
  fetchDevicesOnOnlineBoxes,
  fetchProxiedDevices,
  fetchRunningDbIds,
  mapWithConcurrency,
  runContainer,
  sleep,
  stopContainer,
  waitBootCompleted,
} from "./lib/fleet.mjs";
import { probeRouting, readProxyConfig, waitProxyService } from "./lib/proxy-probe.mjs";
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
  boot_health?: string | null;
  proxy_enabled: boolean | null;
  proxy_type?: string | null;
  proxy_host?: string | null;
  proxy_port?: number | null;
  proxy_account?: string | null;
  proxy_password?: string | null;
  boxes: { name: string; tunnel_hostname: string; status: string };
}

/** A device holding a proxy in the DB mirror, on any box (`fetchProxiedDevices`). */
interface ProxyHolder {
  id: string;
  proxy_host: string | null;
  proxy_port: number | null;
  boxes: { status: string; tunnel_hostname: string } | null;
}

interface Assignment {
  device: DeviceRow;
  proxy: ProxyRow | null;
  country: string | null;
}

const STARTS_IN_FLIGHT_PER_BOX = 2;

function parseArgs(argv: string[]) {
  const args = {
    csv: "", dryRun: false, reapply: false, reclaimOffline: false, reclaimFrom: null as string | null, provider: null as string | null,
    box: null as string | null, names: null as Set<string> | null, countries: null as Set<string> | null, report: null as string | null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--csv") args.csv = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--reclaim-offline") args.reclaimOffline = true;
    else if (a === "--reclaim-from") args.reclaimFrom = argv[++i];
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
  const { setProxyConfig, restartContainer } = await import("../src/lib/box-api");
  const host = a.device.boxes.tunnel_hostname;
  const dbId = a.device.db_id;
  // A device that was already up stays up afterwards; it is restarted all the same — the write demands it.
  const startedByUs = !alreadyRunning.has(dbId);
  const out = { box: a.device.boxes.name, user_name: a.device.user_name, db_id: dbId, country: a.country, proxy: `${a.proxy.host}:${a.proxy.port}` };
  try {
    if (startedByUs) {
      await runContainer(host, dbId);
      if ((await waitBootCompleted(host, dbId)) === null) return { ...out, result: "boot_timeout" };
    }
    if (!(await waitProxyService(host, dbId))) return { ...out, result: "proxy_service_timeout" };
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
    // The guest follows the new upstream only after a boot: restart, then prove.
    await restartContainer(host, dbId);
    if ((await waitBootCompleted(host, dbId)) === null) return { ...out, result: "boot_timeout", configured: config.detail };
    if (!(await waitProxyService(host, dbId))) return { ...out, result: "proxy_service_timeout", configured: config.detail };
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

  const [all, holders, busy] = await Promise.all([
    fetchDevicesOnOnlineBoxes() as Promise<DeviceRow[]>,
    fetchProxiedDevices() as Promise<ProxyHolder[]>,
    fetchBusyDeviceIds(),
  ]);
  let devices = all.filter((d) => d.state !== "removed" && !busy.has(d.id));
  if (args.box) devices = devices.filter((d) => d.boxes.tunnel_hostname === args.box);
  // A device the health sweep recorded `dead` is left alone: booting it parks
  // it in VMOS `starting` for hours (FR10, box-1, 26 September 2026) and a
  // device that never boots cannot leak anything. `audit-device-health.mjs
  // --recheck` is the way to clear the verdict first.
  const knownDead = devices.filter((d) => d.boot_health === "dead");
  devices = devices.filter((d) => d.boot_health !== "dead");
  if (args.names) {
    const wanted = args.names;
    const short = (d: DeviceRow) => d.boxes.tunnel_hostname.split(".")[0];
    devices = devices.filter((d) => wanted.has(d.user_name ?? "") || wanted.has(`${short(d)}:${d.user_name ?? ""}`));
  }
  if (args.countries) devices = devices.filter((d) => args.countries!.has(expectedCountry(d) ?? ""));
  if (args.provider) devices = devices.filter((d) => (d.proxy_host ?? "").toLowerCase().includes(args.provider!));

  // Proxies already held by a device (the DB mirror, every box) — the holder
  // keeps it, nobody else gets it. `--reclaim-offline` frees those held on
  // offline boxes, and only those.
  const reserved = new Map<string, string>();
  let reclaimed = 0;
  const reclaimedFrom = (h: ProxyHolder) =>
    (args.reclaimOffline && h.boxes?.status === "offline") || (args.reclaimFrom !== null && h.boxes?.tunnel_hostname === args.reclaimFrom);
  // Only a CONTESTED holding is reclaimed — the same host:port on another
  // device too, i.e. a list re-purposed while the box was away. A port the
  // reclaimed box holds alone is its own (GB52's retry took GB100's port
  // written minutes earlier, 26 September 2026, when every holding was skipped).
  // Who keeps a contested port: a holder outside the reclaimed scope if there
  // is one, else the first reclaimed holder by name (holders come sorted by
  // user_name) — the others are reclaimed and get a new port at their turn.
  const keyOf = (h: ProxyHolder) => (h.proxy_host && h.proxy_port ? proxyKey(h.proxy_host, h.proxy_port) : null);
  const outsideHolder = new Set(holders.filter((h) => keyOf(h) && !reclaimedFrom(h)).map((h) => keyOf(h) as string));
  for (const h of holders) {
    const key = keyOf(h);
    if (!key) continue;
    if (reclaimedFrom(h) && (outsideHolder.has(key) || reserved.has(key))) {
      reclaimed++;
      continue;
    }
    reserved.set(key, h.id);
  }
  const reclaiming = args.reclaimOffline || args.reclaimFrom !== null;

  const { assignments, spare, short, reserved: withheld } = args.reapply
    ? reapplyPlan(devices)
    : planAssignments(devices, proxies, { reserved });
  const planned = assignments.filter((a): a is Assignment & { proxy: ProxyRow } => a.proxy !== null);
  const unplanned = assignments.filter((a) => a.proxy === null);

  console.log(`=== proxy assignment — ${proxies.length} proxies in the list, ${devices.length} device(s) in scope ===`);
  console.log(
    `planned ${planned.length} · without a proxy for their country ${unplanned.length} · withheld (held by another device) ${withheld}` +
      `${reclaiming ? ` · reclaimed ${reclaimed}` : ""} · spare ${JSON.stringify(spare)} · short ${JSON.stringify(short)}`,
  );
  if (unplanned.length) console.log(`  unplanned: ${unplanned.map((a) => `${a.device.boxes.name}/${a.device.user_name ?? a.device.db_id} (${a.country ?? "no country"})`).join(", ")}`);
  if (knownDead.length) console.log(`  known dead, left alone: ${knownDead.map((d) => `${d.boxes.name}/${d.user_name ?? d.db_id}`).join(", ")}`);
  // A device already holding its planned proxy is not touched (it was proven
  // when it got it; `--reapply` is the way to write it again).
  const keepsOwn = (a: Assignment & { proxy: ProxyRow }) => !args.reapply && reserved.get(proxyKey(a.proxy.host, a.proxy.port)) === a.device.id;
  const changes = planned.filter((a) => !keepsOwn(a));
  console.log(`${planned.length - changes.length} device(s) keep their own proxy (not touched) · ${changes.length} to write`);
  if (args.dryRun) {
    for (const a of planned) {
      console.log(`  ${a.device.boxes.name}/${(a.device.user_name ?? a.device.db_id).padEnd(8)} ${a.country} ${keepsOwn(a) ? "= keeps" : "←"} ${a.proxy.host}:${a.proxy.port}${a.proxy.city ? ` (${a.proxy.city})` : ""}`);
    }
    return;
  }

  // Per box, two in flight; boxes in parallel (each has its own ceiling).
  const byBox = new Map<string, (Assignment & { proxy: ProxyRow })[]>();
  for (const a of changes) {
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
