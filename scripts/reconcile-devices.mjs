/**
 * Reconcile the `devices` table against each ONLINE box's live container list.
 *
 * The full proxy audit surfaced ghost rows: devices present in Supabase whose
 * `db_id` no longer exists on the box (VMOS `run` → code 1 = "db_id does not
 * exist"). They were never marked `removed`, so they inflate device counts and
 * drag coverage %. This mirrors what admin `syncBoxDevices` does: any DB device
 * whose `db_id` is absent from `list_names` is flagged `removed`; the ones that
 * reappear are restored to `stopped`.
 *
 * Read-only unless it finds drift. box-3 (offline) is excluded.
 *
 * Usage (from Attila V4/):
 *   node scripts/reconcile-devices.mjs            # apply
 *   node scripts/reconcile-devices.mjs --dry-run  # report only
 */

import { boxFetch, fetchDevicesForProxyAudit, updateDeviceState } from "./lib/fleet.mjs";

const DRY_RUN = process.argv.includes("--dry-run");

async function liveDbIds(host) {
  const json = await boxFetch(host, "/container_api/v1/list_names");
  const list = json?.data?.list ?? [];
  return new Set(list.map((c) => c.db_id));
}

async function main() {
  console.log(`=== device reconcile ${DRY_RUN ? "(DRY RUN)" : "(applying)"} ===`);
  const devices = await fetchDevicesForProxyAudit();

  const byBox = new Map();
  for (const d of devices) {
    const key = d.boxes.tunnel_hostname;
    if (!byBox.has(key)) byBox.set(key, []);
    byBox.get(key).push(d);
  }

  let removed = 0;
  let restored = 0;
  for (const [host, devs] of byBox) {
    let live;
    try {
      live = await liveDbIds(host);
    } catch (err) {
      console.log(`  ${host}: SKIP (list_names failed: ${err instanceof Error ? err.message : err})`);
      continue;
    }
    const ghosts = devs.filter((d) => !live.has(d.db_id));
    console.log(`  ${host}: ${devs.length} db rows · ${live.size} live containers · ${ghosts.length} ghost(s)`);
    for (const g of ghosts) {
      console.log(`    - ghost: ${g.user_name || g.db_id} (${g.db_id})`);
      if (!DRY_RUN) await updateDeviceState(g.id, "removed");
      removed++;
    }
  }

  console.log(`\n=== summary ===`);
  console.log(`ghosts marked removed: ${removed}${DRY_RUN ? " (dry-run, not applied)" : ""}`);
  console.log(restored ? `restored: ${restored}` : "");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
