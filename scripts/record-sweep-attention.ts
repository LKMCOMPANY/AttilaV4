#!/usr/bin/env npx tsx
/**
 * Turn a boot-health sweep report into attention items — what a HUMAN must do
 * about a device the sweep found wanting. The sweep itself only measures and
 * mirrors (`boot_health`, `devices.proxy_*`); this step is deliberately
 * separate so a report can be read before anything is opened.
 *
 *   dead / unstable device            → boot_dead        (critical)
 *   proxy exits in the wrong country  → proxy_incoherent (warning)
 *   guest leaves through the box IP   → proxy_incoherent (critical — a leak)
 *   proxy configured, not routing     → proxy_incoherent (warning)
 *
 * Items are per account (RLS): a device without an account is listed, not
 * opened. `openAttention` dedupes on (target, reason) and refreshes the open
 * item, so re-running after a new sweep is safe.
 *
 * A systemic problem is one item, not a flood: when a box carries more than
 * `--box-threshold` (default 10) proxy findings, one box-scoped
 * `proxy_incoherent` item is opened for it with the device list as evidence
 * (box-3 on 26 September 2026: 85 proxies exiting in the wrong country — the
 * fix is one proxy re-assignment pass, not 85 tickets).
 *
 * Usage (from Attila V4/):
 *   npx tsx scripts/record-sweep-attention.ts --report a.json [b.json …] [--dry-run] [--box-threshold 10]
 *
 * Env: .env.local (Supabase service role).
 */

import { readFile } from "node:fs/promises";
import { loadDotEnvLocal } from "./lib/dotenv.mjs";

interface SweepRow {
  box: string;
  db_id: string;
  user_name: string | null;
  health: "healthy" | "unstable" | "dead";
  boot_ms: number | null;
  note: string | null;
  proxy: {
    config: { status: string; detail?: string };
    routing: { tag: string; detail: string; geo?: { exit: { ip: string; country: string; city?: string } | null; expected: string | null; coherent: boolean } } | null;
  } | null;
}

interface Finding {
  reason: "boot_dead" | "proxy_incoherent";
  severity: "critical" | "warning";
  title: string;
  detail: string;
}

/** The findings one sweep row justifies — pure, so the mapping is readable in one place. */
export function findingsFor(row: SweepRow): Finding[] {
  const out: Finding[] = [];
  if (row.health !== "healthy") {
    out.push({ reason: "boot_dead", severity: "critical", title: `Device ${row.user_name ?? row.db_id} does not boot`, detail: `${row.health}: ${row.note ?? "no boot_completed"}` });
  }
  const proxy = row.proxy;
  if (proxy && proxy.config.status === "proxied") {
    const routing = proxy.routing;
    if (routing?.tag === "UNPROXIED") {
      out.push({ reason: "proxy_incoherent", severity: "critical", title: `${row.user_name ?? row.db_id} leaves through the box's own address`, detail: `${proxy.config.detail}: guest egress ${routing.geo?.exit?.ip ?? "?"} = box WAN — the proxy is not applied` });
    } else if (routing && routing.tag !== "ROUTES") {
      const what = routing.tag === "no-engine" ? "no host-side engine and the box's proxy is older than 1.3.1 — re-probe after the redeploy" : `proxy not routing (${routing.tag}: ${routing.detail})`;
      out.push({ reason: "proxy_incoherent", severity: "warning", title: `Proxy of ${row.user_name ?? row.db_id} is not in service`, detail: `${proxy.config.detail}: ${what}` });
    } else if (routing?.geo && !routing.geo.coherent && routing.geo.exit) {
      out.push({
        reason: "proxy_incoherent",
        severity: "warning",
        title: `Proxy of ${row.user_name ?? row.db_id} exits in ${routing.geo.exit.country}, persona is ${routing.geo.expected}`,
        detail: `${proxy.config.detail} → ${routing.geo.exit.country}/${routing.geo.exit.city ?? "?"} (${routing.geo.exit.ip}); expected ${routing.geo.expected}`,
      });
    }
  }
  return out;
}

function parseArgs(argv: string[]) {
  const reports: string[] = [];
  let dryRun = false;
  let boxThreshold = 10;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--report") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) reports.push(argv[++i]);
    } else if (argv[i] === "--dry-run") dryRun = true;
    else if (argv[i] === "--box-threshold") boxThreshold = Number(argv[++i]) || 10;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!reports.length) throw new Error("--report <file.json> [more…] is required");
  return { reports, dryRun, boxThreshold };
}

type Planned = { row: SweepRow; finding: Finding };

/**
 * Group the proxy findings per box; a box over the threshold gets one
 * box-scoped finding (its devices in the detail) instead of one per device.
 */
export function planFindings(rows: SweepRow[], boxThreshold: number): { perDevice: Planned[]; perBox: { box: string; findings: Planned[] }[] } {
  const perDevice: Planned[] = [];
  const proxyByBox = new Map<string, Planned[]>();
  for (const row of rows) {
    for (const finding of findingsFor(row)) {
      if (finding.reason !== "proxy_incoherent") { perDevice.push({ row, finding }); continue; }
      if (!proxyByBox.has(row.box)) proxyByBox.set(row.box, []);
      proxyByBox.get(row.box)!.push({ row, finding });
    }
  }
  const perBox: { box: string; findings: Planned[] }[] = [];
  for (const [box, findings] of proxyByBox) {
    if (findings.length > boxThreshold) perBox.push({ box, findings });
    else perDevice.push(...findings);
  }
  return { perDevice, perBox };
}

async function main() {
  const { reports, dryRun, boxThreshold } = parseArgs(process.argv);
  loadDotEnvLocal();
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { openAttention } = await import("../src/lib/maintenance/attention");
  const supabase = createAdminClient();

  const rows: SweepRow[] = [];
  for (const file of reports) rows.push(...(JSON.parse(await readFile(file, "utf8")) as SweepRow[]));

  const dbIds = rows.map((r) => r.db_id);
  const { data: devices, error } = await supabase.from("devices").select("id, db_id, account_id, box_id").in("db_id", dbIds);
  if (error) throw error;
  const byDbId = new Map((devices ?? []).map((d) => [d.db_id, d]));

  const tally = { rows: rows.length, findings: 0, opened: 0, refreshed: 0, noAccount: [] as string[] };
  const { perDevice, perBox } = planFindings(rows, boxThreshold);
  const record = async (input: Parameters<typeof openAttention>[1]) => {
    if (dryRun) return;
    const res = await openAttention(supabase, input);
    if (res.created) tally.opened++;
    else tally.refreshed++;
  };

  for (const { row, finding: f } of perDevice) {
    tally.findings++;
    const device = byDbId.get(row.db_id);
    if (!device?.account_id) {
      tally.noAccount.push(`${row.box.split(".")[0]}/${row.user_name ?? row.db_id}`);
      continue;
    }
    console.log(`${dryRun ? "[dry-run] " : ""}${f.severity.padEnd(8)} ${f.reason.padEnd(16)} ${row.box.split(".")[0]}/${(row.user_name ?? row.db_id).padEnd(8)} ${f.detail}`);
    await record({
      accountId: device.account_id,
      scope: "device",
      deviceId: device.id,
      boxId: device.box_id,
      reason: f.reason,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      evidence: { sweep: "audit-device-health --with-proxy", db_id: row.db_id, boot_ms: row.boot_ms },
      source: "health_worker",
    });
  }

  for (const { box, findings } of perBox) {
    tally.findings += findings.length;
    // The box item lives in the account that owns most of its devices.
    const accounts = new Map<string, number>();
    let boxId: string | null = null;
    for (const { row } of findings) {
      const device = byDbId.get(row.db_id);
      if (device?.account_id) accounts.set(device.account_id, (accounts.get(device.account_id) ?? 0) + 1);
      boxId ??= device?.box_id ?? null;
    }
    const accountId = [...accounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const leaks = findings.filter((f) => f.finding.severity === "critical").length;
    const severity = leaks ? "critical" : "warning";
    const devices = findings.map(({ row, finding }) => `${row.user_name ?? row.db_id}: ${finding.detail}`);
    const title = `${box.split(".")[0]}: ${findings.length} proxies out of order${leaks ? ` (${leaks} unproxied)` : ""}`;
    console.log(`${dryRun ? "[dry-run] " : ""}${severity.padEnd(8)} ${"proxy_incoherent".padEnd(16)} ${box.split(".")[0]} (box) ${findings.length} devices — one item`);
    if (!accountId) { tally.noAccount.push(`${box} (box item)`); continue; }
    await record({
      accountId,
      scope: "box",
      boxId,
      reason: "proxy_incoherent",
      severity,
      title,
      detail: `${findings.length} devices on ${box} exit in the wrong country or not through their proxy (sweep of ${new Date().toISOString().slice(0, 10)}). One proxy re-assignment pass fixes them; the list is in the evidence.`,
      evidence: { sweep: "audit-device-health --with-proxy", devices },
      source: "health_worker",
    });
  }

  console.log(`\nrows ${tally.rows} · findings ${tally.findings} · opened ${tally.opened} · refreshed ${tally.refreshed}`);
  if (tally.noAccount.length) console.log(`no account (listed, not opened) ${tally.noAccount.length}: ${tally.noAccount.join(", ")}`);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
