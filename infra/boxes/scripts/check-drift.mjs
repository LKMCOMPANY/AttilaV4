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
 *   - `/v1/get_hardware_cfg`              → hardware model + cbs + kernel
 *   - `/v1/systeminfo`                    → disk occupancy (mmc + ssd)
 *   - `/container_api/v1/list_names` + `get_android_detail` → live Android image
 *
 * When `CLOUDFLARE_API_TOKEN` is present it ALSO checks (read-only) the control
 * plane: DNS CNAMEs, tunnel health, connected cloudflared version, and whether a
 * remote-managed tunnel config exists (a second source of truth to remove).
 *
 * Then it flags:
 *   - boxes in the DB but MISSING from the manifest (not reproducible from git)
 *   - image / cbs / kernel / cloudflared version drift vs golden
 *   - host disk occupancy past the warn / critical thresholds
 *   - proxy code drift (stale deploy)
 *   - capacity divergence vs the reference box (informational)
 *   - DNS / tunnel / remote-config anomalies (when the CF token is set)
 *   - unreachable boxes (offline / tunnel down)
 *
 * Two things this checker learned the hard way, on 2026-08-31:
 *
 *   1. CBS/kernel come from `/v1/get_hardware_cfg`, NOT `/v1/systeminfo`. The
 *      latter leaves both blank on the 1.1.4.x CBS line, so box-2/3/4 used to
 *      report "unknown" forever. `get_hardware_cfg` answers on every box.
 *   2. Vendor baselines are per HARDWARE MODEL. The fleet mixes `L1` and
 *      `E1.01` hosts and they do not share a kernel; comparing every box to one
 *      global golden told us to converge L1 machines onto E1.01 firmware.
 *
 * Does NOT start containers, change config, or touch any box.
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
// `$`-prefixed keys are documentation embedded in the JSON, not hardware models.
const vendorByModel = Object.fromEntries(
  Object.entries(reference.vendor_by_model ?? {}).filter(([k]) => !k.startsWith("$")),
);
const goldenCloudflared = reference.cloudflared_version ?? null;
const goldenImage = stripTag(reference.android_image?.golden);
const referenceCapacity = reference.reference_capacity?.max_concurrent_containers ?? null;
const diskWarnPct = reference.host_disk?.warn_percent ?? 75;
const diskCriticalPct = reference.host_disk?.critical_percent ?? 85;
const goldenProxy = JSON.parse(
  fs.readFileSync(path.resolve(BOXES_DIR, "..", "magicbox-proxy", "package.json"), "utf8"),
).version;

/**
 * Vendor baseline for a hardware model. An unknown model yields no baseline —
 * reported as such rather than silently compared against another family's
 * firmware, which is exactly the bug this replaced.
 */
function vendorTarget(model) {
  return (model && vendorByModel[model]) || null;
}

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

async function supabaseGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase ${res.status} ${pathAndQuery}`);
  return res.json();
}

async function fetchBoxes() {
  return supabaseGet(
    "boxes?select=id,name,tunnel_hostname,status,max_concurrent_containers,last_heartbeat&order=tunnel_hostname.asc",
  );
}

/**
 * Per-box provisioning tally, from the columns the offline package audit fills
 * (`scripts/audit-device-packages.mjs`). A device is only job-capable with
 * ADBKeyboard AND at least one social app — this is what actually caps the
 * fleet's usable size, and nothing surfaced it before.
 */
async function fetchProvisioning() {
  const rows = await supabaseGet(
    "devices?select=box_id,state,adbkeyboard_installed,tiktok_installed,twitter_installed,boot_health&limit=5000",
  );
  const byBox = new Map();
  for (const d of rows) {
    if (!d.box_id || d.state === "removed") continue;
    if (!byBox.has(d.box_id)) {
      byBox.set(d.box_id, { active: 0, imeMissing: 0, noSocial: 0, capable: 0, notBootable: 0 });
    }
    const t = byBox.get(d.box_id);
    t.active++;
    const hasIme = d.adbkeyboard_installed === true;
    const hasSocial = d.tiktok_installed === true || d.twitter_installed === true;
    if (!hasIme) t.imeMissing++;
    if (!hasSocial) t.noSocial++;
    if (hasIme && hasSocial) t.capable++;
    if (d.boot_health && d.boot_health !== "healthy") t.notBootable++;
  }
  return byBox;
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

async function evaluateBox(box, manifestRow, cfSnap, provisioning) {
  const host = box.tunnel_hostname;
  const [hw, sys, health, image, names] = await Promise.all([
    boxGet(host, "/v1/get_hardware_cfg"),
    boxGet(host, "/v1/systeminfo"),
    boxGet(host, "/healthz"),
    fetchBoxImage(host),
    boxGet(host, "/container_api/v1/list_names"),
  ]);

  // DB rows vs containers that actually exist. Ghost rows inflate every count
  // and send bulk scripts booting things that are not there.
  const liveContainers = names?.data?.list?.length ?? null;
  const tally = provisioning.get(box.id) ?? null;
  const dbActive = tally?.active ?? null;

  // `get_hardware_cfg` answers on every CBS line; `systeminfo` only on 1.1.6.x.
  const model = hw?.data?.model ?? null;
  const cbs = hw?.data?.version ?? sys?.data?.cbs_version ?? null;
  const kernel = hw?.data?.kernel_version ?? sys?.data?.kernel_version ?? null;
  const target = vendorTarget(model);
  const proxyV = health?.version ?? null;
  const reachable = !!(hw || sys || health || image);

  // Container data disks live on the SSD; the eMMC carries the host root.
  const ssdPct = sys?.data?.ssd_percent ?? null;
  const mmcPct = sys?.data?.mmc_percent ?? null;
  const worstDiskPct = Math.max(ssdPct ?? 0, mmcPct ?? 0) || null;

  const tunnel = manifestRow && cfSnap ? cfSnap.tunnelById.get(manifestRow.tunnelId) : null;
  const cloudflaredV = tunnel?.versions?.[0] ?? null;
  const remoteCfg = manifestRow && cfSnap ? cfSnap.remoteConfig.get(manifestRow.tunnelId) : null;

  return {
    name: box.name,
    host,
    dbStatus: box.status,
    reachable,
    image,
    model,
    target,
    cbs,
    kernel,
    ssdPct,
    mmcPct,
    worstDiskPct,
    liveContainers,
    dbActive,
    tally,
    inventoryOk: liveContainers == null || dbActive == null || liveContainers === dbActive,
    proxyV,
    cloudflaredV,
    capacity: box.max_concurrent_containers ?? null,
    manifest: !!manifestRow,
    manifestRow,
    tunnel,
    remoteCfg,
    // Derived drift flags (null version = "unknown", treated as drift, never a pass).
    imageOk: image != null && image === goldenImage,
    modelOk: target != null,
    cbsOk: target != null && cbs != null && cbs === target.cbs_version,
    kernelOk: target != null && kernel != null && kernel === target.kernel_version,
    proxyOk: proxyV != null && proxyV === goldenProxy,
    cloudflaredOk: goldenCloudflared == null || (cloudflaredV != null && cloudflaredV === goldenCloudflared),
    capacityOk: referenceCapacity == null || box.max_concurrent_containers === referenceCapacity,
    diskOk: worstDiskPct == null || worstDiskPct < diskWarnPct,
    diskCritical: worstDiskPct != null && worstDiskPct >= diskCriticalPct,
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
  out.push(
    `  ${"model".padEnd(12)} ${mark(r.modelOk)} ${r.model ?? "(unknown)"}` +
      (r.modelOk ? "" : "   → no vendor baseline for this model in fleet-reference.json"),
  );
  // Vendor targets are per model: an L1 must never be compared to an E1.01.
  out.push(line("cbs", r.cbs, r.cbsOk, r.target?.cbs_version));
  out.push(line("kernel", r.kernel, r.kernelOk, r.target?.kernel_version));
  const diskTag = r.diskCritical ? "✗  " : r.diskOk ? "OK " : "(!)";
  const diskSuffix = r.diskOk ? "" : `   → ${r.diskCritical ? "CRITICAL" : "warn"} ≥${r.diskCritical ? diskCriticalPct : diskWarnPct}%`;
  out.push(`  ${"disk".padEnd(12)} ${diskTag} ssd ${r.ssdPct ?? "?"}% / mmc ${r.mmcPct ?? "?"}%${diskSuffix}`);
  out.push(line("proxy", r.proxyV, r.proxyOk, goldenProxy));
  if (goldenCloudflared) out.push(line("cloudflared", r.cloudflaredV, r.cloudflaredOk, goldenCloudflared));
  // Capacity divergence is informational (per-hardware decision), not a failure.
  const capSuffix = r.capacityOk ? "" : `   (i) reference ${referenceCapacity}`;
  out.push(`  ${"capacity".padEnd(12)} ${r.capacityOk ? "OK " : "(i)"} ${r.capacity ?? "?"}${capSuffix}`);
  out.push(`  ${"manifest".padEnd(12)} ${r.manifest ? "OK  yes" : "✗   MISSING (not reproducible from git)"}`);
  out.push(
    `  ${"inventory".padEnd(12)} ${mark(r.inventoryOk)} ${r.liveContainers ?? "?"} live / ${r.dbActive ?? "?"} in DB` +
      (r.inventoryOk ? "" : "   → run scripts/reconcile-devices.mjs"),
  );
  if (r.tally) {
    // Job-capable = ADBKeyboard + a social app. Everything else is inventory.
    const t = r.tally;
    const capablePct = t.active ? Math.round((100 * t.capable) / t.active) : 0;
    out.push(
      `  ${"provisioned".padEnd(12)} ${t.capable === t.active ? "OK " : "(i)"} ` +
        `${t.capable}/${t.active} job-capable (${capablePct}%)` +
        `   no-IME ${t.imeMissing} · no-social ${t.noSocial}` +
        (t.notBootable ? ` · not-bootable ${t.notBootable}` : ""),
    );
  }

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
  console.log(`Golden image: ${goldenImage}`);
  for (const [model, t] of Object.entries(vendorByModel)) {
    console.log(`Golden vendor [${model}]: cbs=${t.cbs_version} kernel=${t.kernel_version}`);
  }
  console.log(`Disk thresholds: warn ${diskWarnPct}%  critical ${diskCriticalPct}%`);
  console.log(`Golden cloudflared: ${goldenCloudflared ?? "(unset)"}   proxy (git): v${goldenProxy}   reference capacity: ${referenceCapacity ?? "(unset)"}`);
  console.log(CF_API_TOKEN ? "Cloudflare API: enabled (DNS + tunnel + remote-config checks)\n" : "Cloudflare API: disabled (set CLOUDFLARE_API_TOKEN to enable DNS/tunnel checks)\n");

  const manifest = manifestBoxes();
  const manifestByHost = new Map(manifest.map((m) => [m.host, m]));
  const [boxes, cfSnap, provisioning] = await Promise.all([
    fetchBoxes(),
    fetchCloudflare(),
    fetchProvisioning(),
  ]);

  const rows = await Promise.all(
    boxes.map((b) => evaluateBox(b, manifestByHost.get(b.tunnel_hostname), cfSnap, provisioning)),
  );

  for (const r of rows) {
    console.log(renderBox(r, cfSnap));
    console.log("");
  }

  // --- drift summary ---------------------------------------------------------
  const online = rows.filter((r) => r.reachable);
  const offline = rows.filter((r) => !r.reachable);
  // A decommissioned box (status `offline` in the DB) is EXPECTED to be absent
  // from the manifest — that is what decommissioning means. Only a box we still
  // consider part of the fleet is a reproducibility gap.
  const notInManifest = rows.filter((r) => !r.manifest && r.dbStatus !== "offline");
  const decommissioned = rows.filter((r) => !r.manifest && r.dbStatus === "offline");
  const proxyDrift = online.filter((r) => !r.proxyOk);
  const imageDrift = online.filter((r) => !r.imageOk);
  const cbsDrift = online.filter((r) => !r.cbsOk);
  const kernelDrift = online.filter((r) => !r.kernelOk);
  const unknownModel = online.filter((r) => !r.modelOk);
  const diskWarn = online.filter((r) => !r.diskOk && !r.diskCritical);
  const diskCritical = online.filter((r) => r.diskCritical);
  const cloudflaredDrift = online.filter((r) => goldenCloudflared && !r.cloudflaredOk);
  const capacityDrift = rows.filter((r) => !r.capacityOk);
  const remoteCfg = rows.filter((r) => r.remoteCfg);

  console.log("=== drift summary ===");
  console.log(`boxes total          : ${rows.length}  (online ${online.length}, offline ${offline.length})`);
  console.log(`on git proxy version : ${online.filter((r) => r.proxyOk).length}/${online.length}   [actionable]`);
  console.log(`on golden image      : ${online.filter((r) => r.imageOk).length}/${online.length}   [vendor, converge-forward]`);
  console.log(`on model CBS target  : ${online.filter((r) => r.cbsOk).length}/${online.length}   [vendor, per hardware model]`);
  console.log(`on model kernel      : ${online.filter((r) => r.kernelOk).length}/${online.length}   [vendor, per hardware model]`);
  console.log(`disk under ${String(diskWarnPct).padStart(2)}%       : ${online.filter((r) => r.diskOk).length}/${online.length}   [actionable]`);
  if (goldenCloudflared) console.log(`on golden cloudflared: ${online.filter((r) => r.cloudflaredOk).length}/${online.length}   [gated live update]`);

  // Actionable = the layer deploy.sh ships from git (proxy code + manifest coverage).
  if (notInManifest.length) console.log(`\n[!] MISSING from manifest : ${notInManifest.map((r) => r.host).join(", ")}`);
  if (decommissioned.length) console.log(`(i) decommissioned        : ${decommissioned.map((r) => r.host).join(", ")}  — offline in the DB and absent from the manifest, as intended`);
  if (proxyDrift.length) console.log(`[!] proxy drift           : ${proxyDrift.map((r) => `${r.host}(${r.proxyV ?? "none"})`).join(", ")}`);
  // Disk is OURS to fix (offline maintenance pass) — it fails the check.
  if (diskCritical.length) {
    console.log(
      `[!] disk CRITICAL         : ${diskCritical.map((r) => `${r.host}(${r.worstDiskPct}%)`).join(", ")}` +
        `  — guest ext4 writes start failing near full; run the maintenance pass (see fleet-reference.json host_disk.reclaim)`,
    );
  }
  if (diskWarn.length) console.log(`[!] disk warn             : ${diskWarn.map((r) => `${r.host}(${r.worstDiskPct}%)`).join(", ")}`);
  const inventoryDrift = online.filter((r) => !r.inventoryOk);
  if (inventoryDrift.length) {
    console.log(
      `[!] inventory drift       : ${inventoryDrift.map((r) => `${r.host}(${r.liveContainers} live vs ${r.dbActive} DB)`).join(", ")}` +
        "  — run scripts/reconcile-devices.mjs",
    );
  }
  if (unknownModel.length) console.log(`[!] unknown host model    : ${unknownModel.map((r) => `${r.host}(${r.model ?? "n/a"})`).join(", ")}  — add a vendor_by_model baseline`);
  // Gated live actions = Cloudflare-side cleanup + firmware/binary convergence.
  // The local /etc/cloudflared/config.yml wins over any remote config, so a
  // remote config is benign-but-present (a second source of truth to delete).
  if (remoteCfg.length) console.log(`[gated] remote tunnel cfg : ${remoteCfg.map((r) => r.host).join(", ")}  — delete via CF API (local config.yml already wins)`);
  if (imageDrift.length) console.log(`(i) image drift           : ${imageDrift.map((r) => `${r.host}(${r.image ?? "n/a"})`).join(", ")}  — converge-forward`);
  if (cbsDrift.length) console.log(`(i) CBS drift             : ${cbsDrift.map((r) => `${r.host}(${r.model ?? "?"}: ${r.cbs ?? "unknown"})`).join(", ")}  — POST /v1/update_cbs, match the model`);
  if (kernelDrift.length) console.log(`(i) kernel drift          : ${kernelDrift.map((r) => `${r.host}(${r.model ?? "?"}: ${r.kernel ?? "unknown"})`).join(", ")}  — POST /v1/update_kernel, match the model`);
  if (cloudflaredDrift.length) console.log(`(i) cloudflared drift     : ${cloudflaredDrift.map((r) => `${r.host}(${r.cloudflaredV ?? "n/a"})`).join(", ")}  — gated live update`);
  if (capacityDrift.length) console.log(`(i) capacity divergence   : ${capacityDrift.map((r) => `${r.host}(${r.capacity ?? "?"})`).join(", ")}  — set fleet policy`);
  if (offline.length) console.log(`(i) offline               : ${offline.map((r) => r.host).join(", ")}`);

  // Fails on what WE control: the deploy.sh-shipped layer, manifest coverage,
  // host disk headroom, and any host model we have no baseline for. Vendor
  // binary drift, remote-config cleanup and offline boxes stay informational.
  // Fleet-wide provisioning headline: the number that actually bounds how much
  // work the platform can do, and the one nobody was tracking.
  const fleet = [...provisioning.values()].reduce(
    (acc, t) => ({
      active: acc.active + t.active,
      capable: acc.capable + t.capable,
      imeMissing: acc.imeMissing + t.imeMissing,
      noSocial: acc.noSocial + t.noSocial,
    }),
    { active: 0, capable: 0, imeMissing: 0, noSocial: 0 },
  );
  console.log(
    `\njob-capable devices  : ${fleet.capable}/${fleet.active}` +
      `   (missing IME ${fleet.imeMissing} · missing social app ${fleet.noSocial})`,
  );

  const ourLayerClean =
    !notInManifest.length &&
    !proxyDrift.length &&
    !diskCritical.length &&
    !diskWarn.length &&
    !unknownModel.length &&
    !inventoryDrift.length;
  console.log(
    ourLayerClean
      ? "\n✓ deploy.sh layer uniform + captured in git, disk healthy (vendor drift is converge-forward/gated)"
      : "\n✗ actionable drift — see [!] above",
  );
  process.exit(ourLayerClean ? 0 : 2);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
