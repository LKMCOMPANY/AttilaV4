#!/usr/bin/env node
/**
 * OFFLINE app-version audit — which build of X / TikTok / ADBKeyboard every
 * stopped device carries, without booting one.
 *
 * Android 13 writes `/data/system/packages.xml` as Android Binary XML (ABX).
 * The file is read straight off each stopped container's `data.img` with
 * `debugfs` (read-only, never `-w`), streamed back gzip+base64 over the same
 * SSH path as `audit-device-packages.mjs`, and decoded here (`lib/abx.mjs`).
 * Measured 9 September 2026: ~200 KB per container, 154 containers on two
 * boxes in 15 s, zero decode errors.
 *
 * Why it matters: on box-2, 41 of 42 provisioned devices carried an X build
 * behind the "This app is out of date" wall. The Automator and the maintainer
 * both read `device_app_versions` before touching an app.
 *
 * Running containers are skipped (their image is mounted); the maintainer
 * fills their row online through `package/list` when it holds the device.
 *
 * Usage (from Attila V4/):
 *   node scripts/audit-app-versions.mjs                  # report + persist
 *   node scripts/audit-app-versions.mjs --dry-run        # report only
 *   node scripts/audit-app-versions.mjs --box box-2.attila.army
 */

import { gunzipSync } from "node:zlib";
import { loadBoxSshPassword, runOverSsh } from "./lib/box-ssh.mjs";
import { packagesFromAbx } from "./lib/abx.mjs";
import { fetchDevicesWithBoxes, recordAppVersions, recordPackageAudit } from "./lib/fleet.mjs";
import { WATCHED_PACKAGES, twitterWallStatus, versionNameFor } from "./lib/app-versions.mjs";

/** On the box: one line per container — `db_id<TAB>RUNNING` or `db_id<TAB><gzip+base64 of packages.xml>`. */
const REMOTE_SCRIPT = `
RUNNING=" $(docker ps --format '{{.Names}}' 2>/dev/null | tr '\\n' ' ') "
for D in /container_nswc_lv/EDGE*; do
  ID=$(basename "$D"); F="$D/data/data.img"; [ -f "$F" ] || continue
  case "$RUNNING" in *" $ID "*) printf '%s\\tRUNNING\\n' "$ID"; continue;; esac
  B64=$(debugfs -R "cat /system/packages.xml" "$F" 2>/dev/null | gzip -c | base64 -w0)
  printf '%s\\t%s\\n' "$ID" "$B64"
done
`;

const WATCHED = Object.values(WATCHED_PACKAGES);

/** @returns {Map<string, { running: boolean, packages: Map<string,{versionCode:number|null}> | null, error: string | null }>} */
async function readBoxVersions(tunnelHostname, sshPassword) {
  const stdout = await runOverSsh(tunnelHostname, sshPassword, REMOTE_SCRIPT);
  const byDbId = new Map();
  for (const line of stdout.split("\n")) {
    const [dbId, payload] = line.split("\t");
    if (!dbId?.startsWith("EDGE")) continue;
    if (payload === "RUNNING") {
      byDbId.set(dbId, { running: true, packages: null, error: null });
      continue;
    }
    if (!payload) {
      byDbId.set(dbId, { running: false, packages: null, error: "no packages.xml payload" });
      continue;
    }
    try {
      const xml = gunzipSync(Buffer.from(payload, "base64"));
      byDbId.set(dbId, { running: false, packages: packagesFromAbx(xml), error: null });
    } catch (err) {
      byDbId.set(dbId, { running: false, packages: null, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return byDbId;
}

function tally(counts, key) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function printDistribution(label, counts) {
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  ${label}: ${rows.map(([k, n]) => `${k} ×${n}`).join(", ") || "—"}`);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const boxArgIndex = process.argv.indexOf("--box");
  const onlyBox = boxArgIndex > -1 ? process.argv[boxArgIndex + 1] : null;

  const sshPassword = loadBoxSshPassword();
  if (!sshPassword) {
    console.error("Missing BOX_SSH_PASSWORD (infra/boxes/.env or the environment)");
    process.exit(1);
  }

  const devices = (await fetchDevicesWithBoxes()).filter(
    (d) => d.db_id && d.boxes?.tunnel_hostname && d.state !== "removed",
  );
  const byBox = new Map();
  for (const d of devices) {
    const host = d.boxes.tunnel_hostname;
    if (onlyBox && host !== onlyBox) continue;
    if (!byBox.has(host)) byBox.set(host, []);
    byBox.get(host).push(d);
  }

  console.log(`=== offline app-version audit ${dryRun ? "(DRY RUN)" : ""} ===`);
  const totals = { scanned: 0, running: 0, errors: 0, persisted: 0, xWalled: 0, xOk: 0 };

  for (const [host, list] of [...byBox].sort()) {
    let observed;
    try {
      observed = await readBoxVersions(host, sshPassword);
    } catch (err) {
      console.error(`${host}: SSH failed: ${(err.message ?? err).toString().slice(0, 160)}`);
      continue;
    }

    const x = new Map();
    const tiktok = new Map();
    const adbk = new Map();
    let scanned = 0;
    let running = 0;
    let errors = 0;

    for (const device of list) {
      const found = observed.get(device.db_id);
      if (!found) continue;
      if (found.running) {
        running++;
        continue;
      }
      if (!found.packages) {
        errors++;
        console.error(`  ${device.db_id}: ${found.error}`);
        continue;
      }
      scanned++;

      const rows = WATCHED.map((pkg) => {
        const code = found.packages.get(pkg)?.versionCode ?? null;
        return { package: pkg, versionCode: code, versionName: versionNameFor(pkg, code), present: found.packages.has(pkg) };
      });
      const xRow = rows.find((r) => r.package === WATCHED_PACKAGES.twitter);
      const ttRow = rows.find((r) => r.package === WATCHED_PACKAGES.tiktok);
      const kbRow = rows.find((r) => r.package === WATCHED_PACKAGES.adbkeyboard);
      tally(x, xRow.present ? `${xRow.versionName ?? xRow.versionCode}` : "absent");
      tally(tiktok, ttRow.present ? `${ttRow.versionName ?? ttRow.versionCode}` : "absent");
      tally(adbk, kbRow.present ? `${kbRow.versionName ?? kbRow.versionCode}` : "absent");
      const wall = twitterWallStatus(xRow.present ? xRow.versionCode : null);
      if (wall === "ok") totals.xOk++;
      if (wall === "walled_or_at_risk") totals.xWalled++;

      if (!dryRun) {
        await recordAppVersions(
          device.id,
          rows.filter((r) => r.present),
          "offline_packages_xml",
        );
        await recordPackageAudit(device.id, {
          adbkeyboardInstalled: kbRow.present,
          tiktokInstalled: ttRow.present,
          twitterInstalled: xRow.present,
        });
        totals.persisted++;
      }
    }

    console.log(`\n${host}: ${scanned} stopped scanned, ${running} running skipped, ${errors} errors`);
    printDistribution("X", x);
    printDistribution("TikTok", tiktok);
    printDistribution("ADBKeyboard", adbk);
    totals.scanned += scanned;
    totals.running += running;
    totals.errors += errors;
  }

  console.log(
    `\nTOTAL: ${totals.scanned} scanned · ${totals.running} running skipped · ${totals.errors} errors · ` +
      `X ok ${totals.xOk} / walled-or-at-risk ${totals.xWalled}` +
      (dryRun ? "" : ` · ${totals.persisted} devices persisted`),
  );
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
