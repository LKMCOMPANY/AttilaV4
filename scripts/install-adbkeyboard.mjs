/**
 * One-off provisioning script: install ADBKeyboard on every device.
 *
 * Why
 * ----
 * Pipeline jobs are failing with:
 *   "Unknown input method com.android.adbkeyboard/.AdbIME cannot be enabled"
 * because the APK is not present in the VMOS image. We need to install it
 * once per device and enable the IME so future automations can switch to it.
 *
 * What it does
 * ------------
 * For every device in the `devices` table:
 *   1. Start the VMOS container (if not running) and wait until ROM is ready.
 *   2. Install the ADBKeyboard APK via /android_api/v1/install_apk_from_url_batch.
 *   3. Poll `pm list packages | grep adbkeyboard` until the package is present.
 *   4. `ime enable com.android.adbkeyboard/.AdbIME` to make it selectable.
 *   5. Verify the IME is in `ime list -a` output.
 *   6. Stop the container (only if it was stopped at the start).
 *
 * Devices are processed in batches of MAX_CONCURRENCY at a time so we never
 * have more than that many containers running simultaneously.
 *
 * Run from `Attila V4` directory:
 *   node scripts/install-adbkeyboard.mjs
 *   node scripts/install-adbkeyboard.mjs --missing-only --box box-3.attila.army
 *
 * Prefer `--missing-only`: it uses the offline package audit
 * (`audit-device-packages.mjs`) so only the devices that actually lack the APK
 * are booted, instead of starting the whole fleet to ask each one.
 *
 * Env vars are loaded from `.env.local`.
 */

import {
  boxFetch,
  shell,
  fetchRunningDbIds,
  runContainer as startContainer,
  stopContainer,
  fetchDevicesWithBoxes,
  updateDeviceState,
  recordAdbKeyboardState,
  mapWithConcurrency,
  ADBKEYBOARD_APK_URL,
  ADBKEYBOARD_IME,
} from "./lib/fleet.mjs";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const MAX_CONCURRENCY = 10;
const CONTAINER_START_POLL_MS = 2000;
const CONTAINER_START_TIMEOUT_MS = 120_000;
const APK_INSTALL_POLL_MS = 3000;
const APK_INSTALL_TIMEOUT_MS = 180_000;
const POST_BOOT_WAIT_MS = 25_000;
const POST_INSTALL_WAIT_MS = 2000;
const NETWORK_CHECK_TIMEOUT_MS = 60_000;
const APK_INSTALL_MAX_ATTEMPTS = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Box container ops (VMOS) — built on the shared boxFetch/shell in lib/fleet
// ---------------------------------------------------------------------------

async function fetchContainerDetail(boxHost, dbId) {
  try {
    const json = await boxFetch(
      boxHost,
      `/container_api/v1/get_android_detail/${dbId}`
    );
    if (json?.code !== 200 && json?.code !== 201) return null;
    return { ...json.data, _code: json.code };
  } catch (err) {
    return { _error: String(err?.message || err) };
  }
}

async function installApk(boxHost, dbId, url) {
  return boxFetch(boxHost, "/android_api/v1/install_apk_from_url_batch", {
    method: "POST",
    body: JSON.stringify({ db_ids: dbId, url }),
  });
}

// VMOS rejects concurrent install_apk_from_url_batch with
// code 201 "当前有安装任务进行中". Serialise installs per box.
const _boxInstallLocks = new Map();
async function installApkSerialPerBox(boxHost, dbId, url) {
  const prev = _boxInstallLocks.get(boxHost) ?? Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  _boxInstallLocks.set(boxHost, prev.then(() => next));
  await prev;
  try {
    return await installApk(boxHost, dbId, url);
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// Per-device flow
// ---------------------------------------------------------------------------

function logFor(label, dbId, msg, extra) {
  const t = new Date().toISOString().slice(11, 19);
  const line = extra
    ? `[${t}] [${label}] ${dbId.padEnd(16)} ${msg} ${JSON.stringify(extra)}`
    : `[${t}] [${label}] ${dbId.padEnd(16)} ${msg}`;
  console.log(line);
}

async function ensureRunning(boxHost, dbId) {
  const detail = await fetchContainerDetail(boxHost, dbId);
  if (detail?.status === "running") {
    logFor("RUN ", dbId, "already running");
    return { wasRunning: true };
  }
  logFor("RUN ", dbId, `starting (was ${detail?.status ?? "unknown"})`);
  await startContainer(boxHost, dbId);

  const deadline = Date.now() + CONTAINER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(CONTAINER_START_POLL_MS);
    const check = await fetchContainerDetail(boxHost, dbId);
    if (check?.status === "running") {
      logFor("RUN ", dbId, "started OK");
      return { wasRunning: false };
    }
  }
  throw new Error(`container start timeout after ${CONTAINER_START_TIMEOUT_MS}ms`);
}

async function isAdbKeyboardInstalled(boxHost, dbId) {
  const res = await shell(boxHost, dbId, "pm list packages com.android.adbkeyboard");
  return res.message.includes("com.android.adbkeyboard");
}

async function isAdbKeyboardImeRegistered(boxHost, dbId) {
  // ime list -a output is ~15KB and gets truncated by the VMOS shell API,
  // so grep on-device to keep the response tiny and reliable.
  const res = await shell(boxHost, dbId, "ime list -a | grep -i adbkeyboard");
  return res.message.toLowerCase().includes("adbkeyboard");
}

async function waitForApkInstalled(boxHost, dbId, timeoutMs = APK_INSTALL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isAdbKeyboardInstalled(boxHost, dbId)) return true;
    await sleep(APK_INSTALL_POLL_MS);
  }
  return false;
}

async function waitForImeRegistered(boxHost, dbId, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isAdbKeyboardImeRegistered(boxHost, dbId)) return true;
    await sleep(2000);
  }
  return false;
}

async function waitForNetwork(boxHost, dbId) {
  const deadline = Date.now() + NETWORK_CHECK_TIMEOUT_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    const r = await shell(
      boxHost,
      dbId,
      "curl -sI -o /dev/null -w '%{http_code}' --max-time 8 https://github.com",
    );
    const code = (r.message || "").trim();
    if (code.startsWith("2") || code.startsWith("3")) {
      logFor("NET ", dbId, `network OK (HTTP ${code}, attempt ${attempt})`);
      return true;
    }
    logFor("NET ", dbId, `network not ready (got "${code.slice(0, 20)}", attempt ${attempt})`);
    await sleep(3000);
  }
  return false;
}

async function isAdbKeyboardEnabled(boxHost, dbId) {
  const res = await shell(boxHost, dbId, "ime list -s | grep -i adbkeyboard");
  return res.message.toLowerCase().includes("adbkeyboard");
}

async function processDevice(device) {
  const boxHost = device.boxes?.tunnel_hostname;
  if (!boxHost) {
    return { device, ok: false, error: "no box tunnel_hostname" };
  }
  const dbId = device.db_id;

  const result = {
    device,
    ok: false,
    alreadyInstalled: false,
    wasRunning: false,
    error: null,
  };

  try {
    const { wasRunning } = await ensureRunning(boxHost, dbId);
    result.wasRunning = wasRunning;
    if (!wasRunning) await updateDeviceState(device.id, "running");

    if (!wasRunning) {
      logFor("BOOT", dbId, `wait ${POST_BOOT_WAIT_MS}ms for system boot`);
      await sleep(POST_BOOT_WAIT_MS);
    }

    if (await isAdbKeyboardInstalled(boxHost, dbId)) {
      logFor("APK ", dbId, "ADBKeyboard already installed");
      result.alreadyInstalled = true;
    } else {
      const netOk = await waitForNetwork(boxHost, dbId);
      if (!netOk) throw new Error("network not reachable from device");

      let installed = false;
      for (let attempt = 1; attempt <= APK_INSTALL_MAX_ATTEMPTS; attempt++) {
        logFor("APK ", dbId, `installing ADBKeyboard (attempt ${attempt}/${APK_INSTALL_MAX_ATTEMPTS})`);
        const r = await installApkSerialPerBox(boxHost, dbId, ADBKEYBOARD_APK_URL);
        logFor("APK ", dbId, "install_apk response", { code: r?.code, msg: r?.msg });
        installed = await waitForApkInstalled(boxHost, dbId);
        if (installed) break;
        logFor("APK ", dbId, `attempt ${attempt} timed out, retrying`);
      }
      if (!installed) throw new Error("APK install timeout (package not visible after retries)");
      logFor("APK ", dbId, "package visible in pm list");
      await sleep(POST_INSTALL_WAIT_MS);
    }

    // install_apk_from_url_batch installs the APK in a DISABLED state
    // (User 0 ... enabled=0). The IME service filters by enabled apps,
    // so we must explicitly `pm enable` the package first.
    logFor("PM  ", dbId, "pm enable com.android.adbkeyboard");
    const pmEnable = await shell(boxHost, dbId, "pm enable com.android.adbkeyboard");
    if (!pmEnable.ok) {
      logFor("PM  ", dbId, "pm enable WARN", { code: pmEnable.code, output: pmEnable.message.slice(0, 160) });
    }
    await sleep(1000);

    logFor("IME ", dbId, "wait for IME service registration");
    const imeReady = await waitForImeRegistered(boxHost, dbId);
    if (!imeReady) throw new Error("IME never registered (not in `ime list -a`)");
    logFor("IME ", dbId, "IME registered, enabling");

    const enable = await shell(boxHost, dbId, `ime enable ${ADBKEYBOARD_IME}`);
    if (!enable.ok && !enable.message.toLowerCase().includes("already enabled")) {
      logFor("IME ", dbId, "enable WARN", { code: enable.code, output: enable.message.slice(0, 160) });
    }
    await sleep(500);

    const enabled = await isAdbKeyboardEnabled(boxHost, dbId);
    if (!enabled) {
      const all = await shell(boxHost, dbId, "ime list -s");
      logFor("IME ", dbId, "verify FAILED — ime list -s", {
        output: all.message.slice(0, 240),
      });
      throw new Error("IME not enabled after install");
    }
    logFor("IME ", dbId, "ADBKeyboard enabled and selectable");

    result.ok = true;
    await recordAdbKeyboardState(device.id, { installed: true, enabled: true });
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    logFor("ERR ", dbId, "FAILED", { error: result.error });
  } finally {
    if (!result.wasRunning) {
      try {
        logFor("STOP", dbId, "stopping container (was stopped before)");
        await stopContainer(boxHost, dbId);
        await updateDeviceState(device.id, "stopped");
      } catch (err) {
        logFor("STOP", dbId, "stop FAILED", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      logFor("STOP", dbId, "leaving running (was running before)");
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Per-box safe scheduler
//
// Each box has a real RAM-bound capacity (`boxes.max_concurrent_containers`);
// exceeding it sends the host into swap thrashing. We schedule each box
// independently: devices already running are processed in place (no new
// container, no slot cost), and stopped devices are started through a "start
// budget" = boxMax − (containers already running on the box). This guarantees
// `running_baseline + our_starts` never exceeds the box's cap, even when
// operators or the automator have live sessions on the box. MAX_CONCURRENCY is
// only a fallback when a box has no configured max.
// ---------------------------------------------------------------------------

async function listRunningDbIds(boxHost) {
  try {
    return await fetchRunningDbIds(boxHost);
  } catch (err) {
    logFor("BOX ", boxHost, "list_names failed — assuming box full (conservative)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function processBoxSafely(boxHost, boxDevices, requestedConcurrency) {
  // Real per-box capacity (RAM-bound). Falls back to MAX_CONCURRENCY only if a
  // box has no configured max. `--concurrency` (if passed) caps it further.
  const boxMax = boxDevices[0]?.boxes?.max_concurrent_containers ?? MAX_CONCURRENCY;
  const effective = Math.min(requestedConcurrency ?? boxMax, boxMax);

  const runningIds = await listRunningDbIds(boxHost);
  // Unknown running state ⇒ assume the box is full so we never risk overshoot.
  const baselineRunning = runningIds ? runningIds.size : boxMax;
  const startBudget = Math.max(0, boxMax - baselineRunning);

  const alreadyRunning = runningIds
    ? boxDevices.filter((d) => runningIds.has(d.db_id))
    : [];
  const needStart = runningIds
    ? boxDevices.filter((d) => !runningIds.has(d.db_id))
    : boxDevices;

  console.log(
    `\n##### BOX ${boxHost} — ${boxDevices.length} devices | max=${boxMax} baselineRunning=${baselineRunning} startBudget=${startBudget} | running=${alreadyRunning.length} stopped=${needStart.length} #####`,
  );

  const results = [];

  // 1. In-place pass over already-running containers (fast, no boot, no slot).
  if (alreadyRunning.length > 0) {
    results.push(...(await mapWithConcurrency(alreadyRunning, Math.min(effective, 5), processDevice)));
  }

  // 2. Boot-and-provision stopped devices within the start budget.
  const slots = Math.min(effective, startBudget);
  if (needStart.length > 0 && slots <= 0) {
    console.log(`  ${needStart.length} stopped device(s) DEFERRED on ${boxHost} — box at capacity`);
    for (const d of needStart) {
      results.push({ device: d, ok: false, deferred: true, error: "box at capacity (no free slot)" });
    }
  } else if (needStart.length > 0) {
    results.push(...(await mapWithConcurrency(needStart, slots, processDevice)));
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`##### BOX ${boxHost} done: ${okCount}/${results.length} OK #####`);
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== install-adbkeyboard ===");
  console.log(`APK: ${ADBKEYBOARD_APK_URL}`);
  console.log(`Concurrency: per-box max_concurrent_containers (override with --concurrency)`);
  console.log("");

  const devices = await fetchDevicesWithBoxes();
  console.log(`Loaded ${devices.length} devices from Supabase`);

  // Ghost rows have no container on the box: booting them burns the full
  // start timeout for nothing. `reconcile-devices.mjs` flags them.
  let queue = devices.filter((d) => d.state !== "removed");
  if (queue.length !== devices.length) {
    console.log(`Skipped ${devices.length - queue.length} device(s) flagged removed`);
  }

  // `--missing-only`: trust the offline package audit instead of booting every
  // device just to ask. `audit-device-packages.mjs` reads the APK straight off
  // each stopped container's data.img, so this turns a whole-fleet sweep into
  // exactly the devices that need one — 111 instead of 451 on 2026-08-31.
  // NULL means never audited, so it stays in the queue.
  if (process.argv.includes("--missing-only")) {
    const before = queue.length;
    queue = queue.filter((d) => d.adbkeyboard_installed !== true);
    console.log(`--missing-only: ${queue.length} of ${before} device(s) lack the APK`);
  }

  // Optional CLI filter: --only DBID1,DBID2
  // Narrows the CURRENT queue — rebuilding it from `devices` here would undo
  // the `removed` and `--missing-only` filters above and start containers that
  // were deliberately excluded a moment earlier.
  const onlyArgIdx = process.argv.indexOf("--only");
  if (onlyArgIdx >= 0 && process.argv[onlyArgIdx + 1]) {
    const filter = new Set(process.argv[onlyArgIdx + 1].split(",").map((s) => s.trim()));
    const before = queue.length;
    queue = queue.filter((d) => filter.has(d.db_id) || filter.has(d.user_name));
    console.log(`--only: ${queue.length} of ${before} device(s) matched`);
    const missed = [...filter].filter(
      (id) => !queue.some((d) => d.db_id === id || d.user_name === id),
    );
    if (missed.length) {
      console.log(`  not in scope (removed, or already provisioned): ${missed.join(", ")}`);
    }
  }

  // Optional CLI filter: --box box-3.attila.army,box-4.attila.army
  // Restricting a run to a single box keeps every concurrent batch on that box,
  // so `--concurrency` maps 1:1 to containers started there — the only safe way
  // to honour the hard "10 running containers per box" VMOS limit.
  const boxArgIdx = process.argv.indexOf("--box");
  if (boxArgIdx >= 0 && process.argv[boxArgIdx + 1]) {
    const boxFilter = new Set(process.argv[boxArgIdx + 1].split(",").map((s) => s.trim()));
    queue = queue.filter(
      (d) => boxFilter.has(d.boxes?.tunnel_hostname) || boxFilter.has(d.boxes?.name),
    );
    console.log(`Filtered to box(es) ${[...boxFilter].join(", ")}: ${queue.length} devices`);
  }

  // Optional CLI override: --concurrency N (default: each box's configured max)
  let concurrency = null;
  const concIdx = process.argv.indexOf("--concurrency");
  if (concIdx >= 0 && process.argv[concIdx + 1]) {
    const n = parseInt(process.argv[concIdx + 1], 10);
    if (Number.isFinite(n) && n > 0) {
      concurrency = n;
      console.log(`Concurrency overridden to ${concurrency}`);
    }
  }
  console.log("");

  // Group by box so each box is scheduled against its own running-container
  // budget. Boxes are independent (different VMOS hosts) so we run them in
  // parallel; the per-box budget keeps each one within the cap.
  const byBox = new Map();
  for (const d of queue) {
    const host = d.boxes?.tunnel_hostname;
    if (!host) continue;
    if (!byBox.has(host)) byBox.set(host, []);
    byBox.get(host).push(d);
  }
  console.log(`Scheduling ${queue.length} devices across ${byBox.size} box(es)`);

  const perBox = await Promise.all(
    [...byBox.entries()].map(([host, list]) => processBoxSafely(host, list, concurrency)),
  );
  const results = perBox.flat();

  console.log("\n========== SUMMARY ==========");
  const ok = results.filter((r) => r.ok);
  const deferred = results.filter((r) => r.deferred);
  const ko = results.filter((r) => !r.ok && !r.deferred);
  console.log(`OK       : ${ok.length}/${results.length}`);
  console.log(`Deferred : ${deferred.length}/${results.length} (box at capacity — re-run later)`);
  console.log(`Failed   : ${ko.length}/${results.length}`);
  if (ok.length > 0) {
    const reused = ok.filter((r) => r.alreadyInstalled).length;
    console.log(`  - already installed before run: ${reused}`);
    console.log(`  - newly installed             : ${ok.length - reused}`);
  }
  if (ko.length > 0) {
    console.log("\nFailures:");
    for (const r of ko) {
      console.log(`  - ${r.device.user_name} (${r.device.db_id}): ${r.error}`);
    }
  }

  process.exit(ko.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
