#!/usr/bin/env node
/**
 * Tune the on-device screen-projection service (scrcpy 3.3.3).
 *
 * `/var/lib/scd/scd.sh` on the box starts scrcpy with a fixed set of defaults
 * and then appends whatever is in the guest's `/data/local/scd.conf`:
 *
 *   ARGS="$DEFAULT_ARGS $(cat "$CONF_FILE")"
 *
 * So tuning is per device, needs no host change, survives container restarts
 * (the file lives on the data partition) and is undone by deleting the file.
 *
 * What the defaults leave on the table:
 *   - no `video_bit_rate` → the encoder picks its own, with no ceiling on a
 *     link that crosses a Cloudflare tunnel;
 *   - no `max_fps` → the encoder is free to exceed the panel's 30 Hz;
 *   - no key-frame interval → a long GOP, so a reconnect shows nothing until
 *     the next IDR. This is the one that hurts: the operator stares at a frozen
 *     last frame for seconds after every drop;
 *   - `log_level=verbose` → `/data/local/tmp/scd.log` grows without bound. On
 *     box-1 that log was part of what filled a 469 GB disk to 98%.
 *
 * Usage (from Attila V4/):
 *   node scripts/tune-scrcpy.mjs --device EDGE... --box box-5.attila.army
 *   node scripts/tune-scrcpy.mjs --box box-5.attila.army          # every RUNNING device
 *   node scripts/tune-scrcpy.mjs --box box-5.attila.army --revert
 *   node scripts/tune-scrcpy.mjs --box box-5.attila.army --dry-run
 *
 * Only ever touches RUNNING devices: the conf is written into the guest, and a
 * device with a job in flight is skipped outright.
 */

import {
  fetchDevicesWithBoxes,
  fetchBusyDeviceIds,
  fetchRunningDbIds,
  shell,
  sleep,
} from "./lib/fleet.mjs";
import {
  CONF_PATH,
  RESTART_PROJECTION_CMD,
  SCRCPY_MAIN_CLASS,
  TUNED_ARGS,
} from "./lib/scrcpy.mjs";

function parseArgs(argv) {
  const args = { box: null, device: null, revert: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--box") args.box = argv[++i];
    else if (a === "--device") args.device = argv[++i];
    else if (a === "--revert") args.revert = true;
    else if (a === "--dry-run") args.dryRun = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  if (!args.box) {
    console.error("Specify --box <tunnel_hostname>");
    process.exit(1);
  }
  return args;
}

/**
 * Restart the projection service so the new conf takes effect.
 *
 * Asks init to do it — the platform's own mechanism for its own services —
 * rather than killing the process and waiting on the box's supervisor to
 * notice. Two seconds instead of six, and deterministic.
 */
async function restartProjection(boxHost, dbId) {
  const before = await shell(
    boxHost,
    dbId,
    `ps -ef | grep ${SCRCPY_MAIN_CLASS} | grep -v grep | awk '{print $2}'`,
  );
  const oldPid = before.message.trim().split(/\s+/)[0] ?? "";

  await shell(boxHost, dbId, RESTART_PROJECTION_CMD);

  // Poll rather than sleep a fixed span: it is back in ~2 s, and waiting
  // longer than that on 450 devices adds up to nothing useful.
  for (let attempt = 0; attempt < 10; attempt++) {
    await sleep(1000);
    const after = await shell(
      boxHost,
      dbId,
      `ps -ef | grep ${SCRCPY_MAIN_CLASS} | grep -v grep | head -1`,
    );
    const line = after.message.trim();
    const pid = line.split(/\s+/)[1] ?? "";
    if (line.includes(SCRCPY_MAIN_CLASS) && pid !== oldPid) {
      return { restarted: true, args: line };
    }
  }
  return { restarted: false, note: "projection did not come back" };
}

async function applyToDevice(boxHost, device, { revert, dryRun }) {
  const dbId = device.db_id;
  if (dryRun) {
    console.log(`  [dry-run] ${dbId} ${revert ? "would remove" : "would write"} ${CONF_PATH}`);
    return { ok: true, skipped: true };
  }

  const write = revert
    ? `rm -f ${CONF_PATH}; echo removed`
    : `echo '${TUNED_ARGS}' > ${CONF_PATH}; cat ${CONF_PATH}`;
  const wrote = await shell(boxHost, dbId, write);
  if (!wrote.ok) {
    console.log(`  ${dbId} FAILED to write conf: ${wrote.message.slice(0, 100)}`);
    return { ok: false };
  }

  const restart = await restartProjection(boxHost, dbId);
  const applied = revert
    ? !restart.args?.includes("i-frame-interval")
    : restart.args?.includes("i-frame-interval=1");

  console.log(
    `  ${dbId} ${(device.user_name ?? "").padEnd(6)} ` +
      `conf=${revert ? "removed" : "written"} restarted=${restart.restarted} applied=${applied === true}`,
  );
  return { ok: restart.restarted && applied === true };
}

async function main() {
  const args = parseArgs(process.argv);
  const [devices, busy] = await Promise.all([fetchDevicesWithBoxes(), fetchBusyDeviceIds()]);

  const running = await fetchRunningDbIds(args.box);
  const targets = devices.filter(
    (d) =>
      d.boxes?.tunnel_hostname === args.box &&
      running.has(d.db_id) &&
      !busy.has(d.id) &&
      (!args.device || d.db_id === args.device),
  );

  console.log(`=== scrcpy tuning on ${args.box} ${args.revert ? "(REVERT)" : ""} ===`);
  console.log(`running on box : ${running.size}`);
  console.log(`targets        : ${targets.length}`);
  if (!args.revert) console.log(`conf           : ${TUNED_ARGS}`);
  if (!targets.length) {
    console.log("nothing to do — the conf is written into a RUNNING guest, so start the device first");
    return;
  }

  let ok = 0;
  for (const device of targets) {
    const result = await applyToDevice(args.box, device, args);
    if (result.ok) ok++;
  }
  console.log(`\n${ok}/${targets.length} device(s) ${args.revert ? "reverted" : "tuned"}`);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
