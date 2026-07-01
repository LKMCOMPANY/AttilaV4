/**
 * READ-ONLY fleet drift checker.
 *
 * Reconciles the two sources of truth and reports where boxes diverge:
 *   - IaC truth      : infra/boxes/manifest.tsv (which boxes are versioned here)
 *   - Runtime truth  : Supabase `boxes` table (which boxes actually exist)
 *   - Golden versions: infra/boxes/fleet-reference.json (vendor) +
 *                      infra/magicbox-proxy/package.json (proxy)
 *
 * For every box it fetches `/v1/systeminfo` (cbs/kernel) and `/healthz` (proxy
 * version) through the Cloudflare tunnel, then flags:
 *   - boxes in the DB but MISSING from the manifest (not reproducible from git)
 *   - boxes NOT running the golden cbs/kernel version
 *   - boxes NOT running the git proxy version (stale deploy)
 *   - unreachable boxes (offline / tunnel down)
 *
 * Does NOT start containers, change config, or touch any box. Safe to run anytime.
 *
 * Usage (from Attila V4/):  node infra/boxes/scripts/check-drift.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOXES_DIR = path.resolve(__dirname, "..");
const APP_ROOT = path.resolve(__dirname, "..", "..", "..");

// ---------------------------------------------------------------------------
// Env: infra/boxes/.env wins, app .env.local fills the gaps (same as deploy.sh)
// ---------------------------------------------------------------------------

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
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
loadEnv(path.join(BOXES_DIR, ".env"));
loadEnv(path.join(APP_ROOT, ".env.local"));

const CF_ID = process.env.CF_ACCESS_CLIENT_ID;
const CF_SECRET = process.env.CF_ACCESS_CLIENT_SECRET;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

for (const [k, v] of Object.entries({ CF_ACCESS_CLIENT_ID: CF_ID, CF_ACCESS_CLIENT_SECRET: CF_SECRET, NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SUPABASE_KEY })) {
  if (!v) {
    console.error(`Missing env var: ${k} (put it in infra/boxes/.env or Attila V4/.env.local)`);
    process.exit(1);
  }
}

const cf = { "CF-Access-Client-Id": CF_ID, "CF-Access-Client-Secret": CF_SECRET };
const TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

const golden = JSON.parse(fs.readFileSync(path.join(BOXES_DIR, "fleet-reference.json"), "utf8")).vendor;
const goldenProxy = JSON.parse(fs.readFileSync(path.resolve(BOXES_DIR, "..", "magicbox-proxy", "package.json"), "utf8")).version;

function manifestHostnames() {
  const raw = fs.readFileSync(path.join(BOXES_DIR, "manifest.tsv"), "utf8");
  const hosts = new Set();
  for (const line of raw.split("\n")) {
    const m = line.match(/^(\d+)\t/);
    if (m) hosts.add(`box-${m[1]}.attila.army`);
  }
  return hosts;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function boxGet(host, urlPath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://${host}${urlPath}`, { headers: cf, cache: "no-store", signal: controller.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBoxes() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/boxes?select=name,tunnel_hostname&order=tunnel_hostname.asc`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== MagicBox fleet drift check ===");
  console.log(`Golden (ref box ${golden ? "5" : "?"}): cbs=${golden.cbs_version} kernel=${golden.kernel_version} image=${golden.android_image}`);
  console.log(`Golden proxy (git): v${goldenProxy}\n`);

  const inManifest = manifestHostnames();
  const boxes = await fetchBoxes();

  const rows = await Promise.all(
    boxes.map(async (b) => {
      const host = b.tunnel_hostname;
      const [sys, health] = await Promise.all([boxGet(host, "/v1/systeminfo"), boxGet(host, "/healthz")]);
      const reachable = !!(sys || health);
      const cbs = sys?.data?.cbs_version ?? null;
      const kernel = sys?.data?.kernel_version ?? null;
      const proxyV = health?.version ?? null;
      return {
        name: b.name,
        host,
        reachable,
        cbs,
        kernel,
        proxyV,
        manifest: inManifest.has(host),
        cbsOk: cbs === golden.cbs_version,
        kernelOk: kernel === golden.kernel_version,
        proxyOk: proxyV === goldenProxy,
      };
    })
  );

  const flag = (ok, val) => (val == null ? "—" : ok ? val : `${val} ✗`);
  const col = (s, w) => String(s).padEnd(w);
  console.log(
    col("BOX", 26) + col("REACH", 7) + col("CBS", 16) + col("KERNEL", 18) + col("PROXY", 10) + "MANIFEST"
  );
  console.log("-".repeat(85));
  for (const r of rows) {
    console.log(
      col(r.host, 26) +
        col(r.reachable ? "yes" : "OFFLINE", 7) +
        col(flag(r.cbsOk, r.cbs ?? "(n/a)"), 16) +
        col(flag(r.kernelOk, r.kernel ?? "(n/a)"), 18) +
        col(flag(r.proxyOk, r.proxyV ?? "(none)"), 10) +
        (r.manifest ? "yes" : "MISSING ✗")
    );
  }

  // --- drift summary ---------------------------------------------------------
  const offline = rows.filter((r) => !r.reachable);
  const notInManifest = rows.filter((r) => !r.manifest);
  const cbsDrift = rows.filter((r) => r.reachable && !r.cbsOk);
  const proxyDrift = rows.filter((r) => r.reachable && !r.proxyOk);

  console.log("\n=== drift summary ===");
  console.log(`boxes total          : ${rows.length}`);
  console.log(`on git proxy version : ${rows.filter((r) => r.proxyOk).length}/${rows.length}   [actionable]`);
  console.log(`on golden CBS        : ${rows.filter((r) => r.cbsOk).length}/${rows.length}   [vendor, cosmetic]`);

  // Actionable = the layer we ship from git (proxy code + manifest coverage).
  if (notInManifest.length) console.log(`\n[!] MISSING from manifest : ${notInManifest.map((r) => r.host).join(", ")}`);
  if (proxyDrift.length) console.log(`[!] proxy drift           : ${proxyDrift.map((r) => `${r.host}(${r.proxyV ?? "none"})`).join(", ")}`);
  // Informational = vendor firmware (accepted as cosmetic) + known-offline boxes.
  if (cbsDrift.length) console.log(`(i) vendor CBS drift      : ${cbsDrift.map((r) => `${r.host}(${r.cbs ?? "n/a"})`).join(", ")}  — cosmetic, monitored`);
  if (offline.length) console.log(`(i) offline               : ${offline.map((r) => r.host).join(", ")}`);

  // Only our-code drift fails the check; vendor drift and offline boxes are informational.
  const ourLayerClean = !notInManifest.length && !proxyDrift.length;
  console.log(
    ourLayerClean
      ? "\n✓ our-code layer uniform + captured in git (vendor drift cosmetic/monitored)"
      : "\n✗ actionable drift in our-code layer — see [!] above",
  );
  process.exit(ourLayerClean ? 0 : 2);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
