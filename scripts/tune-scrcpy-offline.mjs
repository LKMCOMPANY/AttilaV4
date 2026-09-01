#!/usr/bin/env node
/**
 * Apply the scrcpy tuning to the WHOLE fleet without booting anything.
 *
 * `scripts/tune-scrcpy.mjs` writes `/data/local/scd.conf` from inside a running
 * container, so tuning 450 devices costs 450 Android boots — hours of wall
 * clock, and a VMOS ceiling of 10 running containers per box to respect. This
 * writes the same file straight into the guest's data partition (`data.img`)
 * with `debugfs`, on a container that is switched off. Measured at ~3 s per
 * device, all of them, with nothing started.
 *
 * Why the file survives: `data.img` IS the guest's `/data`, so `/local/scd.conf`
 * in the image is `/data/local/scd.conf` to Android. Verified end to end on
 * box-5 — written offline, booted, and scrcpy came up with the tuned arguments.
 *
 * Safety — the one rule that matters:
 *   ext4 must never be written underneath a mounted filesystem. Every image is
 *   checked for a mount and a loop device before it is touched, on the box
 *   itself, and skipped if either says it is live. The VMOS container list is
 *   a first filter on top of that, not the guarantee.
 *
 * Usage (from Attila V4/):
 *   node scripts/tune-scrcpy-offline.mjs --dry-run          # every box, no writes
 *   node scripts/tune-scrcpy-offline.mjs --box box-5.attila.army
 *   node scripts/tune-scrcpy-offline.mjs                    # every box
 *   node scripts/tune-scrcpy-offline.mjs --revert
 */

import { loadBoxSshPassword, runOverSsh } from "./lib/box-ssh.mjs";
import { fetchDevicesWithBoxes, fetchRunningDbIds } from "./lib/fleet.mjs";
import { CONF_IN_IMAGE, TUNED_ARGS } from "./lib/scrcpy.mjs";

const CONTAINER_ROOT = "/container_nswc_lv";

/**
 * Runs on the box, once per invocation, over every container it is given.
 *
 * Emits one `db_id<TAB>verdict` line per device so the caller can report
 * without a second round trip. Verdicts: `written`, `already`, `reverted`,
 * `absent`, `mounted`, `no-image`, `failed`.
 */
function remoteScript({ dbIds, revert, dryRun }) {
  return `
CONF=${JSON.stringify(TUNED_ARGS)}
for ID in ${dbIds.join(" ")}; do
  IMG="${CONTAINER_ROOT}/$ID/data/data.img"
  if [ ! -f "$IMG" ]; then printf '%s\\tno-image\\n' "$ID"; continue; fi

  # Never write ext4 underneath a live filesystem. Either signal is enough
  # to disqualify the image: a mount entry, or a loop device holding it.
  if grep -qF "$IMG" /proc/mounts 2>/dev/null || losetup -j "$IMG" 2>/dev/null | grep -q .; then
    printf '%s\\tmounted\\n' "$ID"; continue
  fi

  CURRENT=$(debugfs -R "cat /${CONF_IN_IMAGE}" "$IMG" 2>/dev/null | tr -d '\\r\\n')

  if [ "${revert ? "1" : "0"}" = "1" ]; then
    if [ -z "$CURRENT" ]; then printf '%s\\tabsent\\n' "$ID"; continue; fi
    if [ "${dryRun ? "1" : "0"}" = "1" ]; then printf '%s\\treverted\\n' "$ID"; continue; fi
    if debugfs -w -R "rm /${CONF_IN_IMAGE}" "$IMG" >/dev/null 2>&1; then
      printf '%s\\treverted\\n' "$ID"
    else
      printf '%s\\tfailed\\n' "$ID"
    fi
    continue
  fi

  if [ "$CURRENT" = "$CONF" ]; then printf '%s\\talready\\n' "$ID"; continue; fi
  if [ "${dryRun ? "1" : "0"}" = "1" ]; then printf '%s\\twritten\\n' "$ID"; continue; fi

  TMP=$(mktemp)
  printf '%s\\n' "$CONF" > "$TMP"
  # debugfs will not overwrite in place, so clear any previous copy first.
  # A missing file makes rm fail, which is expected and not an error.
  debugfs -w -R "rm /${CONF_IN_IMAGE}" "$IMG" >/dev/null 2>&1
  if debugfs -w -R "write $TMP ${CONF_IN_IMAGE}" "$IMG" >/dev/null 2>&1 \\
     && debugfs -w -R "sif /${CONF_IN_IMAGE} mode 0100644" "$IMG" >/dev/null 2>&1; then
    printf '%s\\twritten\\n' "$ID"
  else
    printf '%s\\tfailed\\n' "$ID"
  fi
  rm -f "$TMP"
done
`;
}

function parseArgs(argv) {
  const args = { box: null, revert: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--box") args.box = argv[++i];
    else if (a === "--revert") args.revert = true;
    else if (a === "--dry-run") args.dryRun = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

async function sweepBox(boxHost, devices, sshPassword, { revert, dryRun }) {
  // First filter: skip what VMOS says is up. The mount guard on the box is the
  // real safety net, but not shipping running containers to it keeps the
  // report honest about why something was skipped.
  let running = new Set();
  try {
    running = new Set(await fetchRunningDbIds(boxHost));
  } catch (err) {
    console.log(`  ! ${boxHost}: could not list containers (${err.message}) — relying on the mount guard`);
  }

  const candidates = devices.filter((d) => !running.has(d.db_id));
  const skippedRunning = devices.length - candidates.length;
  if (!candidates.length) {
    console.log(`  ${boxHost}: nothing to do (${skippedRunning} running)`);
    return [];
  }

  const stdout = await runOverSsh(
    boxHost,
    sshPassword,
    remoteScript({ dbIds: candidates.map((d) => d.db_id), revert, dryRun }),
  );

  const results = [];
  for (const line of stdout.split("\n")) {
    const [dbId, verdict] = line.trim().split("\t");
    if (!dbId?.startsWith("EDGE") || !verdict) continue;
    results.push({ boxHost, dbId, verdict });
  }

  const tally = results.reduce((acc, r) => {
    acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(tally)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ");
  console.log(
    `  ${boxHost}: ${summary}${skippedRunning ? `, ${skippedRunning} skipped (running)` : ""}`,
  );

  for (const failure of results.filter((r) => r.verdict === "failed")) {
    console.log(`    ! ${failure.dbId} failed`);
  }
  return results;
}

async function main() {
  const { box, revert, dryRun } = parseArgs(process.argv);

  const sshPassword = loadBoxSshPassword();
  if (!sshPassword) {
    console.error("No box SSH password — set BOX_SSH_PASSWORD or infra/boxes/.env");
    process.exit(1);
  }

  const devices = await fetchDevicesWithBoxes();
  const byBox = new Map();
  for (const device of devices) {
    const host = device.boxes?.tunnel_hostname;
    if (!host || (box && host !== box)) continue;
    if (device.state === "removed") continue;
    if (!byBox.has(host)) byBox.set(host, []);
    byBox.get(host).push(device);
  }

  if (!byBox.size) {
    console.error(box ? `No devices on ${box}` : "No devices found");
    process.exit(1);
  }

  const action = revert ? "Reverting" : "Applying";
  const mode = dryRun ? " (dry run — no writes)" : "";
  console.log(`${action} scrcpy tuning offline across ${byBox.size} box(es)${mode}\n`);

  const all = [];
  // Serial across boxes: each sweep is one SSH session doing local disk work,
  // so there is nothing to gain from overlapping them and a tidier log to lose.
  for (const [host, boxDevices] of byBox) {
    try {
      all.push(...(await sweepBox(host, boxDevices, sshPassword, { revert, dryRun })));
    } catch (err) {
      console.log(`  ! ${host}: ${err.message}`);
    }
  }

  const tally = all.reduce((acc, r) => {
    acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\nTotal: ${all.length} device(s)`);
  for (const [verdict, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)} ${verdict}`);
  }
  if (!dryRun && !revert && tally.written) {
    console.log("\nThe tuning applies on the device's next start — nothing to restart now.");
  }
  process.exitCode = tally.failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
