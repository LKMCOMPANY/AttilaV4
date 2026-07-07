/**
 * READ-ONLY fleet drift checker.
 *
 * Reconciles the sources of truth and reports where boxes diverge:
 *   - IaC truth      : infra/boxes/manifest.tsv (box num → tunnel id + api_host)
 *   - Runtime truth  : Supabase `boxes` table (which boxes actually exist + capacity)
 *   - Golden versions: infra/boxes/fleet-reference.json (vendor + cloudflared) +
 *                      infra/magicbox-proxy/package.json (proxy code)
 *
 * For every box it fetches, through the Cloudflare tunnel:
 *   - `/healthz`                          → magicbox-proxy version
 *   - `/v1/systeminfo`                    → cbs / kernel version
 *   - `/container_api/v1/list_names` + `get_android_detail` → live Android image
 *
 * When `CLOUDFLARE_API_TOKEN` is present it ALSO checks (read-only) the control
 * plane: DNS CNAMEs, tunnel health, connected cloudflared version, and whether a
 * remote-managed tunnel config exists (a second source of truth to remove).
 *
 * Then it flags:
 *   - boxes in the DB but MISSING from the manifest (not reproducible from git)
 *   - image / cbs / kernel / cloudflared version drift vs golden
 *   - proxy code drift (stale deploy)
 *   - capacity divergence vs the reference box (informational)
 *   - DNS / tunnel / remote-config anomalies (when the CF token is set)
 *   - unreachable boxes (offline / tunnel down)
 *
 * Some boxes run an older CBS whose `/v1/systeminfo` does NOT expose
 * cbs/kernel (returns null): those are reported as "unknown" drift, never as a
 * silent pass. Does NOT start containers, change config, or touch any box.
 *
 * Usage (from Attila V4/):  node infra/boxes/scripts/check-drift.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveZone,
  listDnsRecords,
  listTunnels,
  getTunnelRemoteConfig,
} from "./cf-api.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOXES_DIR = path.resolve(__dirname, "..");
const APP_ROOT = path.resolve(__dirname, "..", "..", "..");
const ZONE_NAME = "attila.army";

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
// Optional: read-only Cloudflare API token (Zone.DNS:Read, Account.Tunnel:Read).
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

for (const [k, v] of Object.entries({
  CF_ACCESS_CLIENT_ID: CF_ID,
  CF_ACCESS_CLIENT_SECRET: CF_SECRET,
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SUPABASE_KEY,
})) {
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

const reference = JSON.parse(fs.readFileSync(path.join(BOXES_DIR, "fleet-reference.json"), "utf8"));
const golden = reference.vendor;
const goldenCloudflared = reference.cloudflared_version ?? null;
const goldenImage = stripTag(golden.android_image);
const referenceCapacity = reference.reference_capacity?.max_concurrent_containers ?? null;
const goldenProxy = JSON.parse(
  fs.readFileSync(path.resolve(BOXES_DIR, "..", "magicbox-proxy", "package.json"), "utf8"),
).version;

/** Docker images carry a `:tag` (usually `:latest`); compare on the repo name only. */
function stripTag(image) {
  return image ? String(image).split(":")[0] : image;
}

/** Parse manifest.tsv → [{ num, host, sshHost, tunnelId }]. */
function manifestBoxes() {
  const raw = fs.readFileSync(path.join(BOXES_DIR, "manifest.tsv"), "utf8");
  const rows = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^(\d+)\t([0-9a-f-]+)\t?(\S+)?/i);
    if (!m) continue;
    rows.push({
      num: Number(m[1]),
      host: `box-${m[1]}.attila.army`,
      sshHost: `ssh-box-${m[1]}.attila.army`,
      tunnelId: m[2],
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Fetch helpers (box HTTP via Cloudflare tunnel)
// ---------------------------------------------------------------------------

async function boxGet(host, urlPath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://${host}${urlPath}`, {
      headers: cf,
      cache: "no-store",
      signal: controller.signal,
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Representative Android image for a box (first container's image). */
async function fetchBoxImage(host) {
  const list = await boxGet(host, "/container_api/v1/list_names");
  const first = list?.data?.list?.[0]?.db_id;
  if (!first) return null;
  const detail = await boxGet(host, `/container_api/v1/get_android_detail/${first}`);
  return stripTag(detail?.data?.image ?? null);
}

async function fetchBoxes() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/boxes?select=name,tunnel_hostname,status,max_concurrent_containers&order=tunnel_hostname.asc`,
    {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      cache: "no-store",
    },
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Cloudflare control-plane snapshot (optional)
// ---------------------------------------------------------------------------

async function fetchCloudflare() {
  if (!CF_API_TOKEN) return null;
  try {
    const { zoneId, accountId } = await resolveZone(CF_API_TOKEN, ZONE_NAME);
    const [dns, tunnels] = await Promise.all([
      listDnsRecords(CF_API_TOKEN, zoneId),
      listTunnels(CF_API_TOKEN, accountId),
    ]);
    const dnsByName = new Map(dns.map((r) => [r.name, r]));
    const tunnelById = new Map(tunnels.map((t) => [t.id, t]));
    const remoteConfig = new Map();
    await Promise.all(
      tunnels.map(async (t) => {
        remoteConfig.set(t.id, await getTunnelRemoteConfig(CF_API_TOKEN, accountId, t.id));
      }),
    );
    return { accountId, dnsByName, tunnelById, remoteConfig };
  } catch (err) {
    console.error(`[warn] Cloudflare API check skipped: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-box evaluation
// ---------------------------------------------------------------------------

async function evaluateBox(box, manifestRow, cfSnap) {
  const host = box.tunnel_hostname;
  const [sys, health, image] = await Promise.all([
    boxGet(host, "/v1/systeminfo"),
    boxGet(host, "/healthz"),
    fetchBoxImage(host),
  ]);

  const cbs = sys?.data?.cbs_version ?? null;
  const kernel = sys?.data?.kernel_version ?? null;
  const proxyV = health?.version ?? null;
  const reachable = !!(sys || health || image);

  const tunnel = manifestRow && cfSnap ? cfSnap.tunnelById.get(manifestRow.tunnelId) : null;
  const cloudflaredV = tunnel?.versions?.[0] ?? null;
  const remoteCfg = manifestRow && cfSnap ? cfSnap.remoteConfig.get(manifestRow.tunnelId) : null;

  return {
    name: box.name,
    host,
    dbStatus: box.status,
    reachable,
    image,
    cbs,
    kernel,
    proxyV,
    cloudflaredV,
    capacity: box.max_concurrent_containers ?? null,
    manifest: !!manifestRow,
    manifestRow,
    tunnel,
    remoteCfg,
    // Derived drift flags (null version = "unknown", treated as drift, never a pass).
    imageOk: image != null && image === goldenImage,
    cbsOk: cbs != null && cbs === golden.cbs_version,
    kernelOk: kernel != null && kernel === golden.kernel_version,
    proxyOk: proxyV != null && proxyV === goldenProxy,
    cloudflaredOk: goldenCloudflared == null || (cloudflaredV != null && cloudflaredV === goldenCloudflared),
    capacityOk: referenceCapacity == null || box.max_concurrent_containers === referenceCapacity,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const mark = (ok) => (ok ? "OK " : "✗  ");

function line(label, value, ok, goldenVal) {
  const shown = value == null ? "(none)" : String(value);
  const suffix = ok ? "" : goldenVal != null ? `   → golden ${goldenVal}` : "   → unknown";
  return `  ${label.padEnd(12)} ${mark(ok)} ${shown}${suffix}`;
}

function renderBox(r, cfSnap) {
  const out = [];
  const statusTag = r.reachable ? "reachable" : `UNREACHABLE (db=${r.dbStatus})`;
  out.push(`${r.host}   [${statusTag}]`);
  if (!r.reachable) {
    out.push(`  (offline — skipping version checks)`);
    return out.join("\n");
  }
  out.push(line("image", r.image, r.imageOk, goldenImage));
  out.push(line("cbs", r.cbs, r.cbsOk, golden.cbs_version));
  out.push(line("kernel", r.kernel, r.kernelOk, golden.kernel_version));
  out.push(line("proxy", r.proxyV, r.proxyOk, goldenProxy));
  if (goldenCloudflared) out.push(line("cloudflared", r.cloudflaredV, r.cloudflaredOk, goldenCloudflared));
  // Capacity divergence is informational (per-hardware decision), not a failure.
  const capSuffix = r.capacityOk ? "" : `   (i) reference ${referenceCapacity}`;
  out.push(`  ${"capacity".padEnd(12)} ${r.capacityOk ? "OK " : "(i)"} ${r.capacity ?? "?"}${capSuffix}`);
  out.push(`  ${"manifest".padEnd(12)} ${r.manifest ? "OK  yes" : "✗   MISSING (not reproducible from git)"}`);

  if (cfSnap) {
    if (r.tunnel) {
      const nameWarn = r.tunnel.name !== `box-${r.manifestRow.num}` ? `   (i) tunnel name "${r.tunnel.name}" ≠ box-${r.manifestRow.num}` : "";
      out.push(`  ${"tunnel".padEnd(12)} ${r.tunnel.status === "healthy" ? "OK " : "✗  "} ${r.tunnel.status}${nameWarn}`);
    }
    // DNS: box-N + ssh-box-N must be proxied CNAMEs to <tunnelId>.cfargotunnel.com
    if (r.manifestRow) {
      const expect = `${r.manifestRow.tunnelId}.cfargotunnel.com`;
      for (const name of [r.manifestRow.host, r.manifestRow.sshHost]) {
        const rec = cfSnap.dnsByName.get(name);
        const ok = rec && rec.type === "CNAME" && rec.content === expect && rec.proxied;
        out.push(`  ${("dns " + (name.startsWith("ssh") ? "ssh" : "http")).padEnd(12)} ${mark(ok)} ${rec ? `${rec.content}${rec.proxied ? " (proxied)" : " (NOT proxied ✗)"}` : "MISSING ✗"}`);
      }
    }
    if (r.remoteCfg) {
      out.push(`  ${"remote-cfg".padEnd(12)} ✗   PRESENT (v${r.remoteCfg.version}, ${r.remoteCfg.ingressCount} rules) — second source of truth, remove`);
    }
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== MagicBox fleet drift check ===");
  console.log(`Golden (ref box ${reference.reference_box}): image=${goldenImage} cbs=${golden.cbs_version} kernel=${golden.kernel_version}`);
  console.log(`Golden cloudflared: ${goldenCloudflared ?? "(unset)"}   proxy (git): v${goldenProxy}   reference capacity: ${referenceCapacity ?? "(unset)"}`);
  console.log(CF_API_TOKEN ? "Cloudflare API: enabled (DNS + tunnel + remote-config checks)\n" : "Cloudflare API: disabled (set CLOUDFLARE_API_TOKEN to enable DNS/tunnel checks)\n");

  const manifest = manifestBoxes();
  const manifestByHost = new Map(manifest.map((m) => [m.host, m]));
  const [boxes, cfSnap] = await Promise.all([fetchBoxes(), fetchCloudflare()]);

  const rows = await Promise.all(
    boxes.map((b) => evaluateBox(b, manifestByHost.get(b.tunnel_hostname), cfSnap)),
  );

  for (const r of rows) {
    console.log(renderBox(r, cfSnap));
    console.log("");
  }

  // --- drift summary ---------------------------------------------------------
  const online = rows.filter((r) => r.reachable);
  const offline = rows.filter((r) => !r.reachable);
  const notInManifest = rows.filter((r) => !r.manifest);
  const proxyDrift = online.filter((r) => !r.proxyOk);
  const imageDrift = online.filter((r) => !r.imageOk);
  const cbsDrift = online.filter((r) => !r.cbsOk);
  const cloudflaredDrift = online.filter((r) => goldenCloudflared && !r.cloudflaredOk);
  const capacityDrift = rows.filter((r) => !r.capacityOk);
  const remoteCfg = rows.filter((r) => r.remoteCfg);

  console.log("=== drift summary ===");
  console.log(`boxes total          : ${rows.length}  (online ${online.length}, offline ${offline.length})`);
  console.log(`on git proxy version : ${online.filter((r) => r.proxyOk).length}/${online.length}   [actionable]`);
  console.log(`on golden image      : ${online.filter((r) => r.imageOk).length}/${online.length}   [vendor, converge-forward]`);
  console.log(`on golden CBS        : ${online.filter((r) => r.cbsOk).length}/${online.length}   [vendor]`);
  if (goldenCloudflared) console.log(`on golden cloudflared: ${online.filter((r) => r.cloudflaredOk).length}/${online.length}   [gated live update]`);

  // Actionable = the layer deploy.sh ships from git (proxy code + manifest coverage).
  if (notInManifest.length) console.log(`\n[!] MISSING from manifest : ${notInManifest.map((r) => r.host).join(", ")}`);
  if (proxyDrift.length) console.log(`[!] proxy drift           : ${proxyDrift.map((r) => `${r.host}(${r.proxyV ?? "none"})`).join(", ")}`);
  // Gated live actions = Cloudflare-side cleanup + firmware/binary convergence.
  // The local /etc/cloudflared/config.yml wins over any remote config, so a
  // remote config is benign-but-present (a second source of truth to delete).
  if (remoteCfg.length) console.log(`[gated] remote tunnel cfg : ${remoteCfg.map((r) => r.host).join(", ")}  — delete via CF API (local config.yml already wins)`);
  if (imageDrift.length) console.log(`(i) image drift           : ${imageDrift.map((r) => `${r.host}(${r.image ?? "n/a"})`).join(", ")}  — converge-forward`);
  if (cbsDrift.length) console.log(`(i) CBS/kernel drift      : ${cbsDrift.map((r) => `${r.host}(${r.cbs ?? "unknown"})`).join(", ")}  — vendor, monitored`);
  if (cloudflaredDrift.length) console.log(`(i) cloudflared drift     : ${cloudflaredDrift.map((r) => `${r.host}(${r.cloudflaredV ?? "n/a"})`).join(", ")}  — gated live update`);
  if (capacityDrift.length) console.log(`(i) capacity divergence   : ${capacityDrift.map((r) => `${r.host}(${r.capacity ?? "?"})`).join(", ")}  — set fleet policy`);
  if (offline.length) console.log(`(i) offline               : ${offline.map((r) => r.host).join(", ")}`);

  // Only the deploy.sh-shipped layer fails the check; vendor/binary drift,
  // remote-config cleanup and offline boxes are informational/gated actions.
  const ourLayerClean = !notInManifest.length && !proxyDrift.length;
  console.log(
    ourLayerClean
      ? "\n✓ deploy.sh layer uniform + captured in git (vendor/binary/remote-cfg drift is converge-forward/gated)"
      : "\n✗ actionable drift in the deploy.sh layer — see [!] above",
  );
  process.exit(ourLayerClean ? 0 : 2);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
