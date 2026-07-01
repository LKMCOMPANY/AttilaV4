/**
 * Fleet-wide ADBKeyboard coverage audit — box-aware.
 *
 * For every box, RUNNING devices are verified live on-device (package installed
 * + IME enabled) and the result is persisted to `devices.adbkeyboard_*`, so
 * coverage becomes queryable without rebooting. STOPPED (or box-offline) devices
 * report their last-known state from the DB. This never starts a container,
 * installs anything, or changes an IME — it only reads the device and writes the
 * observed state back to Supabase.
 *
 * (Previous version audited every device against the FIRST box's host, so it was
 * wrong for any multi-box fleet. It now groups by each device's own box.)
 *
 * Usage:
 *   node scripts/audit-adbkeyboard.mjs                      # whole fleet
 *   node scripts/audit-adbkeyboard.mjs --box box-5.attila.army
 */

import {
  shell,
  fetchRunningDbIds,
  fetchDevicesWithBoxes,
  recordAdbKeyboardState,
  ADBKEYBOARD_PACKAGE,
} from "./lib/fleet.mjs";

const flag = (b) => (b === true ? "OK" : b === false ? "NO" : "-");

/** Live on-device check: is the APK installed and the IME enabled/selectable? */
async function checkRunningDevice(host, dbId) {
  const pkg = await shell(host, dbId, `pm list packages ${ADBKEYBOARD_PACKAGE}`);
  const installed = pkg.message.includes(ADBKEYBOARD_PACKAGE);
  // grep on-device: `ime list -s` is verbose and gets truncated by the shell transport.
  const en = await shell(host, dbId, "ime list -s | grep -i adbkeyboard");
  const enabled = en.message.toLowerCase().includes("adbkeyboard");
  return { installed, enabled };
}

async function main() {
  const boxArgIdx = process.argv.indexOf("--box");
  const boxFilter = boxArgIdx >= 0 ? process.argv[boxArgIdx + 1] : null;

  const devices = await fetchDevicesWithBoxes();

  // Group by the device's OWN box host (the fix — no single shared host).
  const byBox = new Map();
  for (const d of devices) {
    const host = d.boxes?.tunnel_hostname;
    if (!host) continue;
    if (boxFilter && host !== boxFilter && d.boxes?.name !== boxFilter) continue;
    if (!byBox.has(host)) byBox.set(host, []);
    byBox.get(host).push(d);
  }

  const rows = [];
  for (const [host, boxDevices] of byBox) {
    let running;
    try {
      running = await fetchRunningDbIds(host);
    } catch {
      running = null; // box unreachable → fall back to DB for all its devices
    }

    for (const d of boxDevices) {
      const row = {
        box: d.boxes?.name ?? host,
        user_name: d.user_name ?? "",
        db_id: d.db_id,
        state: "",
        installed: null,
        enabled: null,
        source: "",
      };

      if (running === null) {
        row.state = "box_offline";
        row.installed = d.adbkeyboard_installed;
        row.enabled = d.adbkeyboard_enabled;
        row.source = d.adbkeyboard_checked_at ? "db" : "unknown";
      } else if (running.has(d.db_id)) {
        row.state = "running";
        const r = await checkRunningDevice(host, d.db_id);
        row.installed = r.installed;
        row.enabled = r.enabled;
        row.source = "live";
        await recordAdbKeyboardState(d.id, r);
      } else {
        row.state = "stopped";
        row.installed = d.adbkeyboard_installed;
        row.enabled = d.adbkeyboard_enabled;
        row.source = d.adbkeyboard_checked_at ? "db" : "unknown";
      }

      rows.push(row);
      console.log(
        `${String(row.box).padEnd(20)} ${row.user_name.padEnd(12)} ${row.db_id.padEnd(18)} ` +
          `${row.state.padEnd(11)} pkg=${flag(row.installed)} en=${flag(row.enabled)} [${row.source}]`,
      );
    }
  }

  // --- summary -------------------------------------------------------------
  const installedYes = rows.filter((r) => r.installed === true).length;
  const enabledYes = rows.filter((r) => r.enabled === true).length;
  const knownMissing = rows.filter((r) => r.installed === false).length;
  const unknown = rows.filter((r) => r.installed == null).length;
  const liveNow = rows.filter((r) => r.source === "live").length;

  console.log("\n=== summary (fleet-wide) ===");
  console.log(`devices               : ${rows.length}`);
  console.log(`checked live this run : ${liveNow}`);
  console.log(`ADBKeyboard installed : ${installedYes}`);
  console.log(`ADBKeyboard enabled   : ${enabledYes}`);
  console.log(`known-missing (install needed) : ${knownMissing}`);
  console.log(`unknown (never checked)        : ${unknown}`);

  console.log("\nper box (installed / enabled / total):");
  const boxes = [...new Set(rows.map((r) => r.box))].sort();
  for (const b of boxes) {
    const br = rows.filter((r) => r.box === b);
    const ins = br.filter((r) => r.installed === true).length;
    const en = br.filter((r) => r.enabled === true).length;
    console.log(`  ${String(b).padEnd(20)} ${ins} / ${en} / ${br.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
