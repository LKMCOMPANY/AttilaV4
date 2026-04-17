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
 *
 * Env vars are loaded from `.env.local`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Env loader (.env.local)
// ---------------------------------------------------------------------------

function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error(`.env.local not found at ${envPath}`);
  }
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CF_ID = process.env.CF_ACCESS_CLIENT_ID;
const CF_SECRET = process.env.CF_ACCESS_CLIENT_SECRET;

for (const [k, v] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SUPABASE_SERVICE_KEY,
  CF_ACCESS_CLIENT_ID: CF_ID,
  CF_ACCESS_CLIENT_SECRET: CF_SECRET,
})) {
  if (!v) {
    console.error(`Missing env var: ${k}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APK_URL =
  "https://github.com/senzhk/ADBKeyBoard/releases/download/v2.4-dev/keyboardservice-debug.apk";
const ADBKEYBOARD_IME = "com.android.adbkeyboard/.AdbIME";

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
// HTTP helpers
// ---------------------------------------------------------------------------

const cfHeaders = {
  "CF-Access-Client-Id": CF_ID,
  "CF-Access-Client-Secret": CF_SECRET,
};

async function boxFetch(boxHost, urlPath, init = {}) {
  const url = `https://${boxHost}${urlPath}`;
  const headers = { ...cfHeaders, ...(init.headers || {}) };
  if (init.method === "POST" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} ${url} → ${text.slice(0, 200)}`);
  }
  return json;
}

async function shell(boxHost, dbId, cmd) {
  const json = await boxFetch(boxHost, `/android_api/v1/shell/${dbId}`, {
    method: "POST",
    body: JSON.stringify({ id: dbId, cmd }),
  });
  return {
    code: json?.code ?? -1,
    message: json?.data?.message ?? "",
    ok: (json?.code ?? -1) === 200,
  };
}

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

async function startContainer(boxHost, dbId) {
  return boxFetch(boxHost, "/container_api/v1/run", {
    method: "POST",
    body: JSON.stringify({ db_ids: [dbId] }),
  });
}

async function stopContainer(boxHost, dbId) {
  return boxFetch(boxHost, "/container_api/v1/stop", {
    method: "POST",
    body: JSON.stringify({ db_ids: [dbId] }),
  });
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
// Supabase REST
// ---------------------------------------------------------------------------

async function supabaseFetch(pathAndQuery, init = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${pathAndQuery}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${res.status} ${url} → ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function fetchAllDevices() {
  return supabaseFetch(
    "devices?select=id,db_id,user_name,state,box_id,boxes(id,name,tunnel_hostname)&order=user_name.asc"
  );
}

async function updateDeviceState(deviceId, state) {
  return supabaseFetch(`devices?id=eq.${deviceId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      state,
      last_seen: new Date().toISOString(),
    }),
  });
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
        const r = await installApkSerialPerBox(boxHost, dbId, APK_URL);
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
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== install-adbkeyboard ===");
  console.log(`APK: ${APK_URL}`);
  console.log(`Concurrency: ${MAX_CONCURRENCY}`);
  console.log("");

  const devices = await fetchAllDevices();
  console.log(`Loaded ${devices.length} devices from Supabase`);

  // Optional CLI filter: --only DBID1,DBID2
  const onlyArgIdx = process.argv.indexOf("--only");
  let queue = devices;
  if (onlyArgIdx >= 0 && process.argv[onlyArgIdx + 1]) {
    const filter = new Set(process.argv[onlyArgIdx + 1].split(",").map((s) => s.trim()));
    queue = devices.filter((d) => filter.has(d.db_id) || filter.has(d.user_name));
    console.log(`Filtered to ${queue.length} devices`);
  }

  // Optional CLI override: --concurrency N
  let concurrency = MAX_CONCURRENCY;
  const concIdx = process.argv.indexOf("--concurrency");
  if (concIdx >= 0 && process.argv[concIdx + 1]) {
    const n = parseInt(process.argv[concIdx + 1], 10);
    if (Number.isFinite(n) && n > 0) {
      concurrency = n;
      console.log(`Concurrency overridden to ${concurrency}`);
    }
  }
  console.log("");

  const results = [];
  for (let i = 0; i < queue.length; i += concurrency) {
    const batch = queue.slice(i, i + concurrency);
    const batchNum = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(queue.length / concurrency);
    console.log(
      `\n----- Batch ${batchNum}/${totalBatches} (${batch.length} devices) -----`
    );
    console.log(batch.map((d) => `${d.user_name} (${d.db_id})`).join(", "));
    console.log("");

    const batchResults = await Promise.all(batch.map((d) => processDevice(d)));
    results.push(...batchResults);

    const okCount = batchResults.filter((r) => r.ok).length;
    console.log(`\nBatch ${batchNum} done: ${okCount}/${batch.length} OK`);
  }

  console.log("\n========== SUMMARY ==========");
  const ok = results.filter((r) => r.ok);
  const ko = results.filter((r) => !r.ok);
  console.log(`OK     : ${ok.length}/${results.length}`);
  console.log(`Failed : ${ko.length}/${results.length}`);
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
