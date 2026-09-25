/**
 * Golden references and the per-box evaluation of the fleet drift checker.
 *
 *   - fleet-reference.json: vendor baselines per hardware model, runtime pins
 *     (Node, cloudflared), host hygiene targets, disk thresholds.
 *   - infra/magicbox-proxy/package.json: the proxy version (the code is the
 *     source of truth).
 *
 * `evaluateBox` reads the box through its plan (LAN first, tunnel otherwise)
 * and folds the SSH host facts in; it never changes anything.
 */

import fs from "node:fs";
import path from "node:path";
import { BOXES_DIR, supabaseGet } from "./env.mjs";
import { localManagedDigests, renderedCloudflaredDigest } from "./host.mjs";

export const reference = JSON.parse(fs.readFileSync(path.join(BOXES_DIR, "fleet-reference.json"), "utf8"));
// `$`-prefixed keys are documentation embedded in the JSON, not hardware models.
export const vendorByModel = Object.fromEntries(
  Object.entries(reference.vendor_by_model ?? {}).filter(([k]) => !k.startsWith("$")),
);
export const golden = {
  image: stripTag(reference.android_image?.golden),
  imageValidated: reference.android_image?.golden_validated === true,
  cloudflared: reference.runtime?.cloudflared?.version ?? reference.cloudflared_version ?? null,
  node: reference.runtime?.node?.version ?? null,
  capacity: reference.reference_capacity?.max_concurrent_containers ?? null,
  diskWarn: reference.host_disk?.warn_percent ?? 75,
  diskCritical: reference.host_disk?.critical_percent ?? 85,
  hygiene: reference.host_hygiene ?? {},
  proxy: JSON.parse(fs.readFileSync(path.resolve(BOXES_DIR, "..", "magicbox-proxy", "package.json"), "utf8")).version,
};

/** Vendor baseline for a hardware model — unknown model ⇒ no baseline, never another family's. */
export function vendorTarget(model) {
  return (model && vendorByModel[model]) || null;
}

/** Docker images carry a `:tag` (usually `:latest`); compare on the repo name only. */
export function stripTag(image) {
  return image ? String(image).split(":")[0] : image;
}

export async function fetchBoxes() {
  return supabaseGet(
    "boxes?select=id,name,tunnel_hostname,status,lan_ip,max_concurrent_containers,last_heartbeat&order=tunnel_hostname.asc",
  );
}

/**
 * Per-box provisioning tally from the columns the offline package audit fills.
 * A device is only job-capable with ADBKeyboard AND at least one social app —
 * the number that actually caps the fleet's usable size.
 */
export async function fetchProvisioning() {
  const rows = await supabaseGet(
    "devices?select=box_id,state,adbkeyboard_installed,tiktok_installed,twitter_installed,boot_health&limit=5000",
  );
  const byBox = new Map();
  for (const d of rows) {
    if (!d.box_id || d.state === "removed") continue;
    if (!byBox.has(d.box_id)) byBox.set(d.box_id, { active: 0, imeMissing: 0, noSocial: 0, capable: 0, notBootable: 0 });
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

/** Representative Android image for a box (first container's image). */
async function fetchBoxImage(plan) {
  const list = await plan.get("/container_api/v1/list_names");
  const first = list?.data?.list?.[0]?.db_id;
  if (!first) return { image: null, list };
  const detail = await plan.get(`/container_api/v1/get_android_detail/${first}`);
  return { image: stripTag(detail?.data?.image ?? null), list };
}

export async function evaluateBox({ plan, box, manifestRow, cfSnap, provisioning, facts }) {
  const [hw, sys, health, heartbeat, netInfo, imgList, imaged] = await Promise.all([
    plan.get("/v1/get_hardware_cfg"),
    plan.get("/v1/systeminfo"),
    plan.viaTunnel("/healthz"),
    plan.get("/v1/heartbeat"),
    plan.get("/v1/net_info"),
    plan.get("/v1/get_img_list"),
    fetchBoxImage(plan),
  ]);
  const names = imaged.list;
  const liveContainers = names?.data?.list?.length ?? null;
  const running = names?.data?.list?.filter((c) => c.state !== "stopped").length ?? null;
  const tally = provisioning.get(box.id) ?? null;
  const dbActive = tally?.active ?? null;

  const model = hw?.data?.model ?? null;
  const cbs = hw?.data?.version ?? sys?.data?.cbs_version ?? null;
  const kernel = hw?.data?.kernel_version ?? sys?.data?.kernel_version ?? null;
  const target = vendorTarget(model);
  const reachable = !!(hw || sys || health || imaged.image);

  const ssdPct = facts?.ssd_pct ?? sys?.data?.ssd_percent ?? null;
  const mmcPct = facts?.mmc_pct ?? sys?.data?.mmc_percent ?? null;
  const worstDiskPct = Math.max(ssdPct ?? 0, mmcPct ?? 0) || null;
  const swapPct = sys?.data?.swap_percent ?? facts?.swap_pct ?? null;

  const observedLanIp = netInfo?.data?.host_ip ?? health?.lan_ip ?? facts?.lan_ip ?? null;
  const proxyApiHost = health?.api_host ?? null;
  const imagesOnBox = (imgList?.data ?? []).map((i) => stripTag(i.repository));
  const imagesInUse = facts?.images_in_use ? facts.images_in_use.split(",").filter(Boolean) : null;
  const unusedImages = imagesInUse ? imagesOnBox.filter((i) => !imagesInUse.includes(i)) : null;

  const tunnel = manifestRow && cfSnap ? cfSnap.tunnelById.get(manifestRow.tunnelId) : null;
  const cloudflaredV = facts?.cloudflared || tunnel?.versions?.[0] || null;
  const remoteCfg = manifestRow && cfSnap ? cfSnap.remoteConfig.get(manifestRow.tunnelId) : null;

  // Managed-file drift: versioned digest vs what the box carries.
  const wantDigests = { ...localManagedDigests() };
  if (manifestRow) wantDigests["/etc/cloudflared/config.yml"] = renderedCloudflaredDigest(manifestRow.num, manifestRow.tunnelId);
  const fileDrift = facts?.digests ? Object.entries(wantDigests).filter(([f, d]) => facts.digests[f] !== d).map(([f]) => f) : null;

  const h = golden.hygiene;
  const expectHostname = manifestRow ? `box-${manifestRow.num}` : null;
  // Host-fact flags are tri-state: true/false when SSH answered, null when it
  // did not — an unknown is reported as unknown, never as a pass.
  const hf = (cond) => (facts == null ? null : cond());
  return {
    name: box.name, host: box.tunnel_hostname, num: manifestRow?.num ?? null, dbStatus: box.status, reachable,
    transport: plan.lanIp ? `lan ${plan.lanIp}` : "tunnel",
    image: imaged.image, model, target, cbs, kernel, ssdPct, mmcPct, worstDiskPct, swapPct,
    liveContainers, running, dbActive, tally,
    inventoryOk: liveContainers == null || dbActive == null || liveContainers === dbActive,
    proxyV: health?.version ?? null, proxyApiSource: health?.api_source ?? null, proxyApiHost,
    heartbeatOk: heartbeat?.data ? Object.values(heartbeat.data).every(Boolean) : null,
    observedLanIp, dbLanIp: box.lan_ip ?? null,
    cloudflaredV, nodeV: facts?.node ?? null, proxyExec: facts?.proxy_exec ?? null,
    capacity: box.max_concurrent_containers ?? null,
    manifest: !!manifestRow, manifestRow, tunnel, remoteCfg,
    facts, unusedImages, fileDrift,
    // Derived flags (null = unknown, treated as drift, never a pass).
    imageOk: imaged.image != null && imaged.image === golden.image,
    modelOk: target != null,
    cbsOk: target != null && cbs != null && cbs === target.cbs_version,
    kernelOk: target != null && kernel != null && kernel === target.kernel_version,
    proxyOk: health?.version != null && health.version === golden.proxy,
    proxyApiOk: proxyApiHost == null || observedLanIp == null || proxyApiHost === observedLanIp,
    cloudflaredOk: golden.cloudflared == null ? true : cloudflaredV == null ? null : cloudflaredV === golden.cloudflared,
    nodeOk: golden.node == null ? true : hf(() => facts.node === `v${golden.node}`),
    capacityOk: golden.capacity == null || box.max_concurrent_containers === golden.capacity,
    diskOk: worstDiskPct == null || worstDiskPct < golden.diskWarn,
    diskCritical: worstDiskPct != null && worstDiskPct >= golden.diskCritical,
    lanIpOk: observedLanIp == null || box.lan_ip == null || observedLanIp === box.lan_ip,
    hostnameOk: hf(() => expectHostname == null || facts.hostname === expectHostname),
    timezoneOk: hf(() => facts.timezone === h.timezone),
    localeOk: hf(() => facts.lang === h.locale),
    resolversOk: hf(() => facts.resolvers === (h.resolvers ?? []).join(",")),
    swappinessOk: hf(() => facts.swappiness === h.swappiness),
    envFileOk: hf(() => facts.env_file === false && facts.proxy_env_pinned !== true),
    keyOk: hf(() => facts.key_authorized === true),
    imagesOk: unusedImages == null ? null : unusedImages.length === 0,
    orphansOk: hf(() => !facts.orphans),
    filesOk: fileDrift == null ? null : fileDrift.length === 0,
    rootPasswordLocked: hf(() => facts.root_password_auth === "no"),
  };
}
