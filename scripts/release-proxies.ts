#!/usr/bin/env npx tsx
/**
 * Take a proxy AWAY from devices that must not hold it — the dedicated IP is
 * proven on another device, or the persona has no port of its country yet and
 * a shared IP would tie two accounts together (box-5 back online on 26
 * September 2026: 100 rows on the ports the online fleet had taken over).
 *
 * Scope: the devices of one box whose `host:port` another device of the
 * fleet holds too (the DB mirror) — a CONTESTED proxy; or the devices named
 * with `--names`, contested or not. A dedicated port a device holds alone is
 * never touched without its name.
 *
 * Per device, two in flight per box: boot → `proxy_stop` (product code,
 * `clearProxyConfig`) → read back until the device reports no proxy → mirror
 * `devices.proxy_*` to null → stop (only what we started). A device that
 * boots without a proxy leaves with the box's own address, so this is for
 * devices WITHOUT an avatar unless `--with-avatars` says otherwise — the
 * lesser evil is chosen explicitly, never by default. Devices recorded `dead`
 * are left alone.
 *
 * Usage (from Attila V4/):
 *   npx tsx scripts/release-proxies.ts --box box-5.attila.army --dry-run          # contested proxies only
 *   npx tsx scripts/release-proxies.ts --box box-5.attila.army --names FR64,US70  # these, whatever they hold
 *   npx tsx scripts/release-proxies.ts --box box-3.attila.army --names parked_box3_8001 --report out.json
 */

import { writeFile } from "node:fs/promises";
import { fetchBusyDeviceIds, fetchDevicesOnOnlineBoxes, fetchProxiedDevices, fetchRunningDbIds, mapWithConcurrency, runContainer, stopContainer, waitBootCompleted } from "./lib/fleet.mjs";
import { proxyKey } from "./lib/proxy-assignment.mjs";
import { readProxyConfig, waitProxyService } from "./lib/proxy-probe.mjs";
import { loadDotEnvLocal } from "./lib/dotenv.mjs";

interface DeviceRow {
  id: string;
  db_id: string;
  user_name: string | null;
  state: string;
  boot_health?: string | null;
  proxy_host?: string | null;
  proxy_port?: number | null;
  boxes: { name: string; tunnel_hostname: string };
}

const STARTS_IN_FLIGHT_PER_BOX = 2;

function parseArgs(argv: string[]) {
  const args = { box: null as string | null, names: null as Set<string> | null, dryRun: false, withAvatars: false, report: null as string | null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--box") args.box = argv[++i];
    else if (a === "--names") args.names = new Set(argv[++i].split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--with-avatars") args.withAvatars = true;
    else if (a === "--report") args.report = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.box) throw new Error("--box <tunnel_hostname> is required — a release is always scoped to one box");
  return args;
}

async function avatarDeviceIds(deviceIds: string[]): Promise<Set<string>> {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { data } = await createAdminClient().from("avatars").select("device_id").in("device_id", deviceIds).is("archived_at", null);
  return new Set((data ?? []).map((r) => r.device_id as string));
}

async function releaseOne(host: string, d: DeviceRow, alreadyRunning: Set<string>) {
  const { clearProxyConfig } = await import("../src/lib/box-api");
  const startedByUs = !alreadyRunning.has(d.db_id);
  const out = { box: d.boxes.name, user_name: d.user_name, db_id: d.db_id, had: `${d.proxy_host}:${d.proxy_port}` };
  try {
    if (startedByUs) {
      await runContainer(host, d.db_id);
      if ((await waitBootCompleted(host, d.db_id)) === null) return { ...out, result: "boot_timeout" };
    }
    if (!(await waitProxyService(host, d.db_id))) return { ...out, result: "proxy_service_timeout" };
    await clearProxyConfig(host, d.db_id);
    let config = await readProxyConfig(host, { ...d, proxy_host: null }, { dryRun: true });
    for (let attempt = 0; attempt < 5 && config.status !== "no_proxy"; attempt++) config = await readProxyConfig(host, { ...d, proxy_host: null }, { dryRun: true });
    if (config.status !== "no_proxy") return { ...out, result: "still_configured", configured: config.detail };
    await readProxyConfig(host, { ...d, proxy_host: null }); // mirrors null to the DB
    return { ...out, result: "released" };
  } catch (err) {
    return { ...out, result: "error", error: err instanceof Error ? err.message.slice(0, 120) : String(err) };
  } finally {
    if (startedByUs) await stopContainer(host, d.db_id).catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv);
  loadDotEnvLocal();
  const [all, holders, busy] = await Promise.all([
    fetchDevicesOnOnlineBoxes() as Promise<DeviceRow[]>,
    fetchProxiedDevices() as Promise<{ id: string; proxy_host: string | null; proxy_port: number | null }[]>,
    fetchBusyDeviceIds(),
  ]);
  let devices = all.filter((d) => d.boxes.tunnel_hostname === args.box && d.state !== "removed" && !busy.has(d.id) && d.proxy_host);
  if (args.names) devices = devices.filter((d) => args.names!.has(d.user_name ?? ""));
  else {
    // Contested only: the same host:port on more than one device of the fleet.
    const holdersByKey = new Map<string, number>();
    for (const h of holders) if (h.proxy_host && h.proxy_port) holdersByKey.set(proxyKey(h.proxy_host, h.proxy_port), (holdersByKey.get(proxyKey(h.proxy_host, h.proxy_port)) ?? 0) + 1);
    devices = devices.filter((d) => (holdersByKey.get(proxyKey(d.proxy_host!, d.proxy_port!)) ?? 0) > 1);
  }
  const dead = devices.filter((d) => d.boot_health === "dead");
  devices = devices.filter((d) => d.boot_health !== "dead");
  const withAvatar = await avatarDeviceIds(devices.map((d) => d.id));
  const kept = args.withAvatars ? [] : devices.filter((d) => withAvatar.has(d.id));
  if (!args.withAvatars) devices = devices.filter((d) => !withAvatar.has(d.id));

  console.log(`=== proxy release on ${args.box} — ${devices.length} device(s) to release (${args.names ? "named" : "contested proxies only"}) ===`);
  if (kept.length) console.log(`  kept (carry an avatar, --with-avatars to include): ${kept.map((d) => d.user_name ?? d.db_id).join(", ")}`);
  if (dead.length) console.log(`  known dead, left alone: ${dead.map((d) => d.user_name ?? d.db_id).join(", ")}`);
  for (const d of devices) console.log(`  ${(d.user_name ?? d.db_id).padEnd(10)} releases ${d.proxy_host}:${d.proxy_port}`);
  if (args.dryRun || devices.length === 0) return;

  const alreadyRunning = await fetchRunningDbIds(args.box!).catch(() => new Set<string>());
  const results = await mapWithConcurrency(devices, STARTS_IN_FLIGHT_PER_BOX, async (d: DeviceRow) => {
    const r = await releaseOne(args.box!, d, alreadyRunning);
    console.log(`  ${d.boxes.name} ${(d.user_name ?? d.db_id).padEnd(8)} ${r.result.padEnd(16)} ${"configured" in r ? r.configured : ""}${"error" in r ? r.error : ""}`);
    return r;
  });
  const tally: Record<string, number> = {};
  for (const r of results) tally[r.result] = (tally[r.result] ?? 0) + 1;
  console.log(`\n=== summary === ${JSON.stringify(tally)}`);
  if (args.report) await writeFile(args.report, JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
