/**
 * Environment, secrets and the two ways to reach a box, shared by the fleet
 * scripts (check-drift.mjs, box-power.mjs).
 *
 *   - env: infra/boxes/.env wins, the app .env.local fills the gaps — the same
 *     precedence as scripts/lib/transport.sh.
 *   - HTTP to a box: LAN first (the box proved its identity by device_id), the
 *     Cloudflare tunnel with the CF Access service token otherwise. The runtime
 *     on Render is tunnel-only; LAN-first is for tooling on the operator's LAN.
 *   - SSH to a box: fleet key through the agent, root password as bootstrap.
 *
 * Nothing here mutates a box.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { discoverLanIp, manifestBoxes } from "./lan.mjs";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BOXES_DIR = path.resolve(__dirname, "..", "..");
export const APP_ROOT = path.resolve(BOXES_DIR, "..", "..");
export const TIMEOUT_MS = 8000;

export function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv(path.join(BOXES_DIR, ".env"));
loadEnv(path.join(APP_ROOT, ".env.local"));

export function requireEnv(names) {
  for (const k of names) {
    if (!process.env[k]) {
      console.error(`Missing env var: ${k} (put it in infra/boxes/.env or Attila V4/.env.local)`);
      process.exit(1);
    }
  }
}

export const cfHeaders = () => ({
  "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
  "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET,
});

// ---------------------------------------------------------------------------
// Supabase (service role, read-only usage here)
// ---------------------------------------------------------------------------

export async function supabaseGet(pathAndQuery) {
  return supabaseRequest("GET", pathAndQuery);
}

/** PostgREST call with the service role; `body` is JSON-encoded, rows are returned. */
export async function supabaseRequest(method, pathAndQuery, body) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: method === "GET" ? "" : "return=representation",
    },
    body: body == null ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase ${res.status} ${method} ${pathAndQuery}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** POST to a box (Container API) through its plan: LAN first, tunnel otherwise. */
export async function boxPost(plan, p, body) {
  const targets = [];
  if (plan.lanIp) targets.push({ url: `http://${plan.lanIp}:18182${p}`, headers: {} });
  targets.push({ url: `https://${plan.tunnelHostname}${p}`, headers: cfHeaders() });
  for (const t of targets) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(t.url, {
        method: "POST",
        headers: { ...t.headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.ok) return await res.json();
    } catch {
      /* next transport */
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Box HTTP — LAN first, tunnel otherwise
// ---------------------------------------------------------------------------

/**
 * A reachability plan for one box: `lanIp` when the box is on this LAN and
 * proved its device_id, always the tunnel hostname. `viaLan(path)` and
 * `viaTunnel(path)` both return parsed JSON or null; `get(path)` tries the LAN
 * first. `/healthz` and `/stream-ready` live on the proxy, which listens on
 * 127.0.0.1 only — those are tunnel-only by construction.
 */
export async function planBox(num, tunnelHostname) {
  const row = manifestBoxes().find((m) => m.num === num);
  const lanIp = row ? await discoverLanIp(row) : null;
  const viaTunnel = (p) => getJson(`https://${tunnelHostname}${p}`, cfHeaders());
  const viaLan = (p) => (lanIp ? getJson(`http://${lanIp}:18182${p}`) : Promise.resolve(null));
  return {
    num,
    tunnelHostname,
    lanIp,
    viaLan,
    viaTunnel,
    get: async (p) => (lanIp ? (await viaLan(p)) ?? (await viaTunnel(p)) : viaTunnel(p)),
  };
}

export async function getJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, cache: "no-store", signal: controller.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// SSH — key through the agent first, password as bootstrap
// ---------------------------------------------------------------------------

const SSH_COMMON = ["-o", "ConnectTimeout=15", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR"];

/**
 * Run `script` (bash, read from stdin) as root on a box and return stdout.
 * `target` is a LAN ip or `ssh-box-N.attila.army`; the tunnel form adds the
 * `cloudflared access ssh` ProxyCommand. Returns null when no auth works.
 */
export async function sshRun(target, script, { viaTunnel = false } = {}) {
  const proxy = viaTunnel
    ? ["-o", `ProxyCommand=cloudflared access ssh --hostname %h --service-token-id ${process.env.CF_ACCESS_CLIENT_ID} --service-token-secret ${process.env.CF_ACCESS_CLIENT_SECRET}`]
    : [];
  const keyFile = process.env.BOX_SSH_KEY || path.join(os.homedir(), ".ssh", "id_ed25519_attila");
  const attempts = [];
  if (fs.existsSync(keyFile)) {
    attempts.push({ cmd: "ssh", args: [...SSH_COMMON, ...proxy, "-o", "BatchMode=yes", "-o", "PreferredAuthentications=publickey", "-i", keyFile, `root@${target}`, "bash -s"], env: process.env });
  }
  if (process.env.BOX_SSH_PASSWORD) {
    attempts.push({
      cmd: "sshpass",
      args: ["-e", "ssh", ...SSH_COMMON, ...proxy, "-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no", `root@${target}`, "bash -s"],
      env: { ...process.env, SSHPASS: process.env.BOX_SSH_PASSWORD },
    });
  }
  // sshd on the boxes intermittently refuses a password login right after
  // another session (observed 25 Sep 2026, cleared by a retry): one retry per
  // method, spaced out, before giving up.
  for (const a of attempts) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const child = execFileP(a.cmd, a.args, { env: a.env, maxBuffer: 8 * 1024 * 1024, timeout: 90_000 });
        child.child.stdin.end(script);
        const { stdout } = await child;
        return stdout;
      } catch {
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
  }
  return null;
}
