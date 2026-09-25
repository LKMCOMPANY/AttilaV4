#!/usr/bin/env npx tsx
/**
 * Turn a boot-health sweep report into attention items — what a HUMAN must do
 * about a device the sweep found wanting. The sweep itself only measures and
 * mirrors (`boot_health`, `devices.proxy_*`); this step is deliberately
 * separate so a report can be read before anything is opened.
 *
 *   dead / unstable device            → boot_dead        (critical)
 *   proxy exits in the wrong country  → proxy_incoherent (warning)
 *   proxy configured, engine missing  → proxy_incoherent (warning)
 *   proxy configured, not routing     → proxy_incoherent (warning)
 *
 * Items are per account (RLS): a device without an account is listed, not
 * opened. `openAttention` dedupes on (target, reason) and refreshes the open
 * item, so re-running after a new sweep is safe.
 *
 * Usage (from Attila V4/):
 *   npx tsx scripts/record-sweep-attention.ts --report a.json [b.json …] [--dry-run]
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
    if (routing && routing.tag !== "ROUTES") {
      const what = routing.tag === "no-engine" ? "proxy engine never provisioned — traffic may leave unproxied" : `proxy not routing (${routing.tag}: ${routing.detail})`;
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
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--report") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) reports.push(argv[++i]);
    } else if (argv[i] === "--dry-run") dryRun = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!reports.length) throw new Error("--report <file.json> [more…] is required");
  return { reports, dryRun };
}

async function main() {
  const { reports, dryRun } = parseArgs(process.argv);
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
  for (const row of rows) {
    const findings = findingsFor(row);
    if (!findings.length) continue;
    tally.findings += findings.length;
    const device = byDbId.get(row.db_id);
    if (!device?.account_id) {
      tally.noAccount.push(`${row.box.split(".")[0]}/${row.user_name ?? row.db_id}`);
      continue;
    }
    for (const f of findings) {
      console.log(`${dryRun ? "[dry-run] " : ""}${f.severity.padEnd(8)} ${f.reason.padEnd(16)} ${row.box.split(".")[0]}/${(row.user_name ?? row.db_id).padEnd(8)} ${f.detail}`);
      if (dryRun) continue;
      const res = await openAttention(supabase, {
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
      if (res.created) tally.opened++;
      else tally.refreshed++;
    }
  }

  console.log(`\nrows ${tally.rows} · findings ${tally.findings} · opened ${tally.opened} · refreshed ${tally.refreshed}`);
  if (tally.noAccount.length) console.log(`no account (listed, not opened) ${tally.noAccount.length}: ${tally.noAccount.join(", ")}`);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
