/**
 * Rendering of the fleet drift report and the exit-code decision.
 *
 * What fails the check (exit 2) is what WE control: the deploy.sh layer
 * (proxy version, Node, cloudflared, managed files, hygiene, key, no pinned
 * IP), manifest coverage, DB ↔ box inventory and lan_ip, host disk headroom,
 * unused images, orphan directories, and any host model without a baseline.
 * Vendor firmware drift, the Android image and Cloudflare remote configs stay
 * informational / gated.
 */

import { fmtBytes } from "./host.mjs";
import { golden } from "./vendor.mjs";

// Tri-state: true passes, false fails, null is "could not be read" — shown as
// such and, unless --no-ssh was asked for, counted as drift (never as a pass).
const mark = (ok) => (ok === true ? "OK " : ok === false ? "✗  " : "?  ");

function line(label, value, ok, goldenVal) {
  const shown = value == null ? "(none)" : String(value);
  const suffix = ok === true ? "" : ok === null ? "   → not read" : goldenVal != null ? `   → golden ${goldenVal}` : "   → unknown";
  return `  ${label.padEnd(12)} ${mark(ok)} ${shown}${suffix}`;
}

export function renderHeader(cfEnabled) {
  const out = ["=== MagicBox fleet drift check ==="];
  out.push(`Golden image: ${golden.image}${golden.imageValidated ? "" : "  (candidate, not yet validated on a device)"}`);
  out.push(`Disk thresholds: warn ${golden.diskWarn}%  critical ${golden.diskCritical}%`);
  out.push(`Golden runtime: cloudflared ${golden.cloudflared ?? "(unset)"} · node v${golden.node ?? "?"} · proxy (git) v${golden.proxy} · capacity ${golden.capacity ?? "(unset)"}`);
  out.push(cfEnabled ? "Cloudflare API: enabled (DNS + tunnel + remote-config checks)\n" : "Cloudflare API: disabled (set CLOUDFLARE_API_TOKEN to enable DNS/tunnel checks)\n");
  return out.join("\n");
}

export function renderVendorTargets(vendorByModel) {
  return Object.entries(vendorByModel)
    .map(([model, t]) => `Golden vendor [${model}]: cbs=${t.cbs_version} kernel=${t.kernel_version}${t.cbs_fallback ? ` (cbs fallback ${t.cbs_fallback})` : ""}`)
    .join("\n");
}

export function renderBox(r, cfSnap) {
  const out = [];
  const statusTag = r.reachable ? `reachable via ${r.transport}` : `UNREACHABLE (db=${r.dbStatus})`;
  out.push(`${r.host}   [${statusTag}]`);
  if (!r.reachable) {
    out.push(`  (offline — skipping version checks)`);
    return out.join("\n");
  }
  out.push(line("image", r.image, r.imageOk, golden.image));
  out.push(`  ${"model".padEnd(12)} ${mark(r.modelOk)} ${r.model ?? "(unknown)"}` + (r.modelOk ? "" : "   → no vendor baseline for this model in fleet-reference.json"));
  out.push(line("cbs", r.cbs, r.cbsOk, r.target?.cbs_version));
  out.push(line("kernel", r.kernel, r.kernelOk, r.target?.kernel_version));
  const diskTag = r.diskCritical ? "✗  " : r.diskOk ? "OK " : "(!)";
  const diskSuffix = r.diskOk ? "" : `   → ${r.diskCritical ? "CRITICAL" : "warn"} ≥${r.diskCritical ? golden.diskCritical : golden.diskWarn}%`;
  out.push(`  ${"disk".padEnd(12)} ${diskTag} ssd ${r.ssdPct ?? "?"}% / mmc ${r.mmcPct ?? "?"}%${diskSuffix}`);
  out.push(`  ${"heartbeat".padEnd(12)} ${mark(r.heartbeatOk === true)} ${r.heartbeatOk == null ? "(no answer)" : r.heartbeatOk ? "docker+http+ping" : "DEGRADED"}   running ${r.running ?? "?"}   swap ${r.swapPct ?? "?"}%`);
  out.push(line("proxy", r.proxyV, r.proxyOk, golden.proxy));
  out.push(`  ${"api host".padEnd(12)} ${mark(r.proxyApiOk)} ${r.proxyApiHost ?? "(1.2.x: not reported)"}${r.proxyApiSource ? ` (${r.proxyApiSource})` : ""}${r.proxyApiOk ? "" : `   → box says ${r.observedLanIp}`}`);
  out.push(`  ${"lan_ip".padEnd(12)} ${mark(r.lanIpOk)} observed ${r.observedLanIp ?? "?"} / db ${r.dbLanIp ?? "?"}${r.lanIpOk ? "" : "   → DB stale (reconcile persists /v1/net_info)"}`);
  if (golden.cloudflared) out.push(line("cloudflared", r.cloudflaredV, r.cloudflaredOk, golden.cloudflared));
  if (golden.node) out.push(line("node", r.nodeV, r.nodeOk, `v${golden.node}`));
  const capSuffix = r.capacityOk ? "" : `   (i) reference ${golden.capacity}`;
  out.push(`  ${"capacity".padEnd(12)} ${r.capacityOk ? "OK " : "(i)"} ${r.capacity ?? "?"}${capSuffix}`);
  out.push(`  ${"manifest".padEnd(12)} ${r.manifest ? "OK  yes" : "✗   MISSING (not reproducible from git)"}`);
  out.push(`  ${"inventory".padEnd(12)} ${mark(r.inventoryOk)} ${r.liveContainers ?? "?"} live / ${r.dbActive ?? "?"} in DB` + (r.inventoryOk ? "" : "   → run scripts/reconcile-devices.mjs"));
  if (r.tally) {
    const t = r.tally;
    const capablePct = t.active ? Math.round((100 * t.capable) / t.active) : 0;
    out.push(`  ${"provisioned".padEnd(12)} ${t.capable === t.active ? "OK " : "(i)"} ${t.capable}/${t.active} job-capable (${capablePct}%)   no-IME ${t.imeMissing} · no-social ${t.noSocial}` + (t.notBootable ? ` · not-bootable ${t.notBootable}` : ""));
  }
  renderHost(out, r);
  if (cfSnap) renderCloudflare(out, r, cfSnap);
  return out.join("\n");
}

function renderHost(out, r) {
  const f = r.facts;
  if (!f) {
    out.push(`  ${"host".padEnd(12)} (i) SSH facts unavailable (no key in the agent and no BOX_SSH_PASSWORD?)`);
    return;
  }
  const idOk = r.hostnameOk && r.timezoneOk && r.localeOk ? true : false;
  out.push(`  ${"identity".padEnd(12)} ${mark(idOk)} ${f.hostname} · ${f.timezone} · ${f.lang}${idOk ? "" : `   → box-${r.num} · ${golden.hygiene.timezone} · ${golden.hygiene.locale}`}`);
  out.push(`  ${"resolvers".padEnd(12)} ${mark(r.resolversOk)} ${f.resolvers || "(none)"}${r.resolversOk ? "" : `   → ${(golden.hygiene.resolvers ?? []).join(",")}`}`);
  out.push(`  ${"swappiness".padEnd(12)} ${mark(r.swappinessOk)} ${f.swappiness}${r.swappinessOk ? "" : `   → ${golden.hygiene.swappiness} (something raised it at runtime)`}`);
  out.push(`  ${"logs".padEnd(12)} (i) journal ${f.journal || "?"} · /var/log ${fmtBytes(f.varlog_bytes)} · mihomo ${fmtBytes(f.mihomo_bytes)} · logrotate ${f.logrotate_timer}`);
  out.push(`  ${"images".padEnd(12)} ${mark(r.imagesOk)} ${r.unusedImages == null ? "?" : r.unusedImages.length === 0 ? "no unused image" : `unused: ${r.unusedImages.join(", ")}   → GET /v1/prune_images`}`);
  out.push(`  ${"orphans".padEnd(12)} ${mark(r.orphansOk)} ${f.orphans ? `${f.orphans}   → SSD dirs without a container (gated cleanup)` : "none"}`);
  out.push(`  ${"files".padEnd(12)} ${mark(r.filesOk)} ${r.fileDrift == null ? "?" : r.fileDrift.length === 0 ? "all managed files current" : `drift: ${r.fileDrift.join(", ")}   → deploy.sh`}`);
  const pinned = [f.env_file ? "/etc/magicbox-proxy.env" : null, f.proxy_env_pinned ? "systemd Environment=API_HOST" : null].filter(Boolean);
  out.push(`  ${"pinned ip".padEnd(12)} ${mark(r.envFileOk)} ${pinned.length ? `${pinned.join(" + ")} PRESENT   → deploy.sh removes it (the box-4 failure)` : "none"}`);
  out.push(`  ${"ssh".padEnd(12)} ${mark(r.keyOk && r.sshdInetOk)} fleet key ${f.key_authorized ? "authorized" : "MISSING"} · root password ${f.root_password_auth === "no" ? "locked" : "allowed (gated)"} · listens ${f.sshd_address_family === "inet" ? "IPv4 only" : `${f.sshd_address_family || "?"} (IPv6 too ✗)`} · ipv6 global ${f.ipv6_global}`);
  out.push(`  ${"cbs_go".padEnd(12)} ${mark(f.supervisor_cbs === "RUNNING")} supervisord ${f.supervisor_cbs || "?"} · docker root ${f.docker_root} · load1 ${f.load1} · up ${Math.round(f.uptime_s / 3600)} h`);
}

function renderCloudflare(out, r, cfSnap) {
  if (r.tunnel) {
    const nameWarn = r.tunnel.name !== `box-${r.manifestRow.num}` ? `   (i) tunnel name "${r.tunnel.name}" ≠ box-${r.manifestRow.num}` : "";
    out.push(`  ${"tunnel".padEnd(12)} ${r.tunnel.status === "healthy" ? "OK " : "✗  "} ${r.tunnel.status}${nameWarn}`);
  }
  if (r.manifestRow) {
    const expect = `${r.manifestRow.tunnelId}.cfargotunnel.com`;
    for (const name of [r.manifestRow.host, r.manifestRow.sshHost]) {
      const rec = cfSnap.dnsByName.get(name);
      const ok = rec && rec.type === "CNAME" && rec.content === expect && rec.proxied;
      out.push(`  ${("dns " + (name.startsWith("ssh") ? "ssh" : "http")).padEnd(12)} ${mark(ok)} ${rec ? `${rec.content}${rec.proxied ? " (proxied)" : " (NOT proxied ✗)"}` : "MISSING ✗"}`);
    }
  }
  if (r.remoteCfg) out.push(`  ${"remote-cfg".padEnd(12)} ✗   PRESENT (v${r.remoteCfg.version}, ${r.remoteCfg.ingressCount} rules) — second source of truth, remove`);
}

/** Summary + exit code. Returns the process exit code. */
export function renderSummary(rows, provisioning, { noSsh = false } = {}) {
  const online = rows.filter((r) => r.reachable);
  const offline = rows.filter((r) => !r.reachable);
  const notInManifest = rows.filter((r) => !r.manifest && r.dbStatus !== "offline");
  const decommissioned = rows.filter((r) => !r.manifest && r.dbStatus === "offline");
  // A flag that could not be read (null) is drift unless SSH was skipped on purpose.
  const pick = (k) => online.filter((r) => (noSsh ? r[k] === false : r[k] !== true));
  const failing = {
    "host facts unreadable (ssh)": noSsh ? [] : online.filter((r) => r.manifest && r.facts == null),
    "proxy drift": pick("proxyOk"),
    "proxy api host ≠ box": pick("proxyApiOk"),
    "cloudflared drift": pick("cloudflaredOk"),
    "node drift": pick("nodeOk"),
    "managed files drift": pick("filesOk"),
    "identity (hostname/tz/locale)": online.filter((r) => [r.hostnameOk, r.timezoneOk, r.localeOk].some((v) => (noSsh ? v === false : v !== true))),
    "resolvers": pick("resolversOk"),
    "swappiness": pick("swappinessOk"),
    "pinned IP env file": pick("envFileOk"),
    "fleet key missing": pick("keyOk"),
    "sshd listening on IPv6": pick("sshdInetOk"),
    "unused images": pick("imagesOk"),
    "orphan SSD dirs": pick("orphansOk"),
    "lan_ip stale in DB": pick("lanIpOk"),
    "inventory drift": pick("inventoryOk"),
    "heartbeat degraded": online.filter((r) => r.heartbeatOk === false),
    "disk warn/critical": pick("diskOk"),
    "unknown host model": pick("modelOk"),
  };

  console.log("=== drift summary ===");
  console.log(`boxes total          : ${rows.length}  (online ${online.length}, offline ${offline.length})`);
  console.log(`on git proxy version : ${online.filter((r) => r.proxyOk).length}/${online.length}   [actionable]`);
  console.log(`on golden cloudflared: ${online.filter((r) => r.cloudflaredOk).length}/${online.length}   [actionable]`);
  console.log(`on golden node       : ${online.filter((r) => r.nodeOk).length}/${online.length}   [actionable]`);
  console.log(`hygiene converged    : ${online.filter((r) => [r.filesOk, r.hostnameOk, r.timezoneOk, r.localeOk, r.resolversOk, r.swappinessOk, r.envFileOk, r.keyOk, r.sshdInetOk].every((v) => v === true)).length}/${online.length}   [actionable]`);
  console.log(`on golden image      : ${online.filter((r) => r.imageOk).length}/${online.length}   [vendor, canary-gated]`);
  console.log(`on model CBS target  : ${online.filter((r) => r.cbsOk).length}/${online.length}   [vendor, per hardware model, gated]`);
  console.log(`on model kernel      : ${online.filter((r) => r.kernelOk).length}/${online.length}   [vendor, per hardware model, gated]`);
  console.log(`disk under ${String(golden.diskWarn).padStart(2)}%       : ${online.filter((r) => r.diskOk).length}/${online.length}   [actionable]`);

  if (notInManifest.length) console.log(`\n[!] MISSING from manifest : ${notInManifest.map((r) => r.host).join(", ")}`);
  if (decommissioned.length) console.log(`(i) decommissioned        : ${decommissioned.map((r) => r.host).join(", ")}  — offline in the DB and absent from the manifest`);
  for (const [label, list] of Object.entries(failing)) {
    if (list.length) console.log(`[!] ${label.padEnd(26)}: ${list.map((r) => r.host).join(", ")}`);
  }
  const imageDrift = online.filter((r) => !r.imageOk);
  const cbsDrift = online.filter((r) => !r.cbsOk);
  const kernelDrift = online.filter((r) => !r.kernelOk);
  const remoteCfg = rows.filter((r) => r.remoteCfg);
  const capacityDrift = rows.filter((r) => !r.capacityOk);
  const unlocked = online.filter((r) => r.rootPasswordLocked === false);
  if (remoteCfg.length) console.log(`[gated] remote tunnel cfg : ${remoteCfg.map((r) => r.host).join(", ")}  — delete via CF API (local config.yml already wins)`);
  if (unlocked.length) console.log(`[gated] root password ssh : ${unlocked.map((r) => r.host).join(", ")}  — deploy.sh --lock-root-password after the key is in the agent`);
  if (imageDrift.length) console.log(`(i) image drift           : ${imageDrift.map((r) => `${r.host}(${r.image ?? "n/a"})`).join(", ")}  — canary upgrade_image on a parked device first`);
  if (cbsDrift.length) console.log(`(i) CBS drift             : ${cbsDrift.map((r) => `${r.host}(${r.model ?? "?"}: ${r.cbs ?? "unknown"})`).join(", ")}  — Phase 2, POST /v1/update_cbs, match the model`);
  if (kernelDrift.length) console.log(`(i) kernel drift          : ${kernelDrift.map((r) => `${r.host}(${r.model ?? "?"}: ${r.kernel ?? "unknown"})`).join(", ")}  — Phase 2, POST /v1/update_kernel, one-way`);
  if (capacityDrift.length) console.log(`(i) capacity divergence   : ${capacityDrift.map((r) => `${r.host}(${r.capacity ?? "?"})`).join(", ")}  — set fleet policy`);
  if (offline.length) console.log(`(i) offline               : ${offline.map((r) => r.host).join(", ")}`);

  const fleet = [...provisioning.values()].reduce(
    (acc, t) => ({ active: acc.active + t.active, capable: acc.capable + t.capable, imeMissing: acc.imeMissing + t.imeMissing, noSocial: acc.noSocial + t.noSocial }),
    { active: 0, capable: 0, imeMissing: 0, noSocial: 0 },
  );
  console.log(`\njob-capable devices  : ${fleet.capable}/${fleet.active}   (missing IME ${fleet.imeMissing} · missing social app ${fleet.noSocial})`);

  const clean = !notInManifest.length && Object.values(failing).every((l) => l.length === 0);
  console.log(clean ? "\n✓ our layer is uniform and captured in git; disk healthy (vendor drift is gated)" : "\n✗ actionable drift — see [!] above");
  return clean ? 0 : 2;
}
