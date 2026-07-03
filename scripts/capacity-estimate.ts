/**
 * CLI wrapper for the campaign capacity estimator — same code path as the
 * Automator UI (`estimateZoneVolume` + `applyCampaignFilters`), useful to
 * debug a zone's numbers without clicking through the app.
 *
 * Usage:
 *   npx tsx scripts/capacity-estimate.ts \
 *     --zone b8f59098-eefe-4821-98bc-241a17fccfc8 \
 *     --network tiktok \
 *     [--filters '{"min_play_count":1000,"exclude_ads":true}']
 *
 * Env: GORGONE_SUPABASE_URL + GORGONE_SUPABASE_SERVICE_ROLE_KEY
 * (loaded from .env.local automatically when present).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

loadDotEnvLocal();

import { estimateZoneVolume, applyCampaignFilters } from "../src/lib/gorgone";
import type { CampaignFilters, GorgoneNetwork } from "../src/types";

async function main() {
  const args = process.argv.slice(2);

  function getArg(name: string, required = true): string | null {
    const idx = args.indexOf(`--${name}`);
    if (idx === -1 || idx + 1 >= args.length) {
      if (required) throw new Error(`Missing required argument: --${name}`);
      return null;
    }
    return args[idx + 1];
  }

  const zoneId = getArg("zone")!;
  const network = getArg("network")! as GorgoneNetwork;
  const filtersRaw = getArg("filters", false);
  const filters: CampaignFilters = filtersRaw ? JSON.parse(filtersRaw) : {};

  const started = Date.now();
  const zoneData = await estimateZoneVolume(zoneId, network);
  const filtered = applyCampaignFilters(zoneData, filters);
  const elapsed = Date.now() - started;

  const { volume } = zoneData;
  console.log(`\n— Zone ${zoneId} · ${network} · fetched in ${elapsed}ms`);
  console.log(`Window     ${volume.window.since} → ${volume.window.anchor}`);
  console.log(`           effective ${volume.window.effective_hours}h of ${volume.window.period_hours}h`);
  console.log(`Volume     ${volume.total_posts} posts · ${volume.avg_per_hour}/h · sample ${volume.sample_size}`);
  console.log(`Breakdown  ${JSON.stringify(volume.breakdown, null, 2)}`);
  console.log(`Languages  ${JSON.stringify(volume.by_language)}`);
  console.log(`\nFilters    ${JSON.stringify(filters)}`);
  console.log(`Filtered   ${filtered.filtered_per_hour}/h (joint pass ${(filtered.filter_pass_rate * 100).toFixed(1)}%)`);
  for (const f of filtered.filters_applied) {
    console.log(`           ${f.label}: ${(f.pass_rate * 100).toFixed(1)}%`);
  }
}

function loadDotEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1 || line.trimStart().startsWith("#")) continue;
    const key = line.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = line.slice(eq + 1).trim();
  }
}

main().catch((err) => {
  console.error("capacity-estimate failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
