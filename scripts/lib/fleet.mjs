/**
 * Shared fleet helpers for the standalone provisioning / audit scripts
 * (install-adbkeyboard.mjs, audit-adbkeyboard.mjs). Node ESM, zero deps.
 *
 * Importing this module loads `.env.local` and validates the required secrets,
 * then exposes one implementation of the VMOS box HTTP client, the Supabase REST
 * client, the device query, and the ADBKeyboard constants — so each script no
 * longer re-declares its own copy.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) throw new Error(`.env.local not found at ${envPath}`);
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
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
// ADBKeyboard artifacts
// ---------------------------------------------------------------------------

export const ADBKEYBOARD_PACKAGE = "com.android.adbkeyboard";
export const ADBKEYBOARD_IME = "com.android.adbkeyboard/.AdbIME";
export const ADBKEYBOARD_APK_URL =
  "https://github.com/senzhk/ADBKeyBoard/releases/download/v2.4-dev/keyboardservice-debug.apk";

// ---------------------------------------------------------------------------
// VMOS box HTTP client (via Cloudflare Access)
// ---------------------------------------------------------------------------

const cfHeaders = {
  "CF-Access-Client-Id": CF_ID,
  "CF-Access-Client-Secret": CF_SECRET,
};

export async function boxFetch(boxHost, urlPath, init = {}) {
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

/** Run an ADB shell command on a device. `ok` is true only on VMOS code 200. */
export async function shell(boxHost, dbId, cmd) {
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

/** Set of `db_id`s currently `running` on a box. Throws if the box is unreachable. */
export async function fetchRunningDbIds(boxHost) {
  const json = await boxFetch(boxHost, "/container_api/v1/list_names");
  const list = json?.data?.list ?? [];
  return new Set(list.filter((c) => c.state === "running").map((c) => c.db_id));
}

// ---------------------------------------------------------------------------
// Supabase REST (service role — bypasses RLS, scripts only)
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

/** All devices with their box + last-known ADBKeyboard state, ordered by name. */
export async function fetchDevicesWithBoxes() {
  return supabaseFetch(
    "devices?select=id,db_id,user_name,state,box_id,adbkeyboard_installed,adbkeyboard_enabled,adbkeyboard_checked_at," +
      "boxes(id,name,tunnel_hostname,max_concurrent_containers)&order=user_name.asc",
  );
}

export async function updateDeviceState(deviceId, state) {
  return supabaseFetch(`devices?id=eq.${deviceId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ state, last_seen: new Date().toISOString() }),
  });
}

/** Persist the observed ADBKeyboard state (installed / enabled) + a timestamp. */
export async function recordAdbKeyboardState(deviceId, { installed, enabled }) {
  return supabaseFetch(`devices?id=eq.${deviceId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      adbkeyboard_installed: installed,
      adbkeyboard_enabled: enabled,
      adbkeyboard_checked_at: new Date().toISOString(),
    }),
  });
}
