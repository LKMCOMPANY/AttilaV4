#!/usr/bin/env npx tsx
/**
 * Turn a boot-health sweep report into attention items — what a HUMAN must do
 * about a device the sweep found wanting. The sweep itself only measures and
 * mirrors (`boot_health`, `devices.proxy_*`); this step is deliberately
 * separate so a report can be read before anything is opened. What a row
 * means is decided in `scripts/lib/sweep-findings.mjs` (pure, tested); this
 * file reads reports and writes items.
 *
 * Items are per account (RLS): a device without an account is listed, not
 * opened. `openAttention` dedupes on (target, reason) and refreshes the open
 * item, so re-running after a new sweep is safe — and a device the new sweep
 * finds healthy and routing gets its open `boot_dead` / `proxy_incoherent`
 * items resolved by `reprobe`: the sweep is the re-probe.
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
import { planFindings } from "./lib/sweep-findings.mjs";

type SweepRow = Parameters<typeof planFindings>[0][number];

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

async function main() {
  const { reports, dryRun, boxThreshold } = parseArgs(process.argv);
  loadDotEnvLocal();
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { openAttention, resolveAttentionForTarget } = await import("../src/lib/maintenance/attention");
  const supabase = createAdminClient();

  const rows: SweepRow[] = [];
  for (const file of reports) rows.push(...(JSON.parse(await readFile(file, "utf8")) as SweepRow[]));

  const dbIds = rows.map((r) => r.db_id);
  const { data: devices, error } = await supabase.from("devices").select("id, db_id, account_id, box_id").in("db_id", dbIds);
  if (error) throw error;
  const byDbId = new Map((devices ?? []).map((d) => [d.db_id, d]));
  type Device = NonNullable<typeof devices>[number] & { account_id: string };
  // One definition of a device item's target, for opening and for resolving:
  // the key carries the box, and a resolve built without it matched nothing
  // (found 26 September 2026 — six items a verification sweep should have closed).
  const deviceTarget = (device: Device) => ({ accountId: device.account_id, scope: "device" as const, deviceId: device.id, boxId: device.box_id });

  const tally = { rows: rows.length, findings: 0, opened: 0, refreshed: 0, resolved: 0, noAccount: [] as string[] };
  const { perDevice, perBox } = planFindings(rows, boxThreshold);

  // Per reason, close what an earlier sweep opened and this one no longer
  // finds: a device that boots again but has no proxy yet keeps its proxy
  // item and loses its boot one (FR10, 26 September 2026 — skipping the whole
  // device left a `boot_dead` item on a phone that had just been rebuilt).
  const REASONS = ["boot_dead", "proxy_incoherent"] as const;
  const foundByDbId = new Map<string, Set<string>>();
  for (const { row, finding } of [...perDevice, ...perBox.flatMap((b) => b.findings)]) {
    if (!foundByDbId.has(row.db_id)) foundByDbId.set(row.db_id, new Set());
    foundByDbId.get(row.db_id)!.add(finding.reason);
  }
  for (const row of rows) {
    const device = byDbId.get(row.db_id);
    if (!device?.account_id || dryRun) continue;
    const gone = REASONS.filter((r) => !foundByDbId.get(row.db_id)?.has(r));
    if (gone.length) tally.resolved += await resolveAttentionForTarget(supabase, deviceTarget(device as Device), "reprobe", gone);
  }
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
      ...deviceTarget(device as Device),
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

  console.log(`\nrows ${tally.rows} · findings ${tally.findings} · opened ${tally.opened} · refreshed ${tally.refreshed} · resolved by reprobe ${tally.resolved}`);
  if (tally.noAccount.length) console.log(`no account (listed, not opened) ${tally.noAccount.length}: ${tally.noAccount.join(", ")}`);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
