/**
 * READ-ONLY fleet drift checker.
 *
 * Reconciles the sources of truth and reports where boxes diverge:
 *   - IaC truth      : infra/boxes/manifest.tsv (box num → tunnel id, device_id, MAC)
 *   - Runtime truth  : Supabase `boxes` table (which boxes exist, status, lan_ip, capacity)
 *   - Golden versions: infra/boxes/fleet-reference.json (vendor, runtime pins, hygiene)
 *                      + infra/magicbox-proxy/package.json (proxy code)
 *
 * For every box it reads — LAN first when the box proves its device_id on
 * this LAN, the Cloudflare tunnel otherwise (lib/env.mjs):
 *   - /v1/get_hardware_cfg, /v1/systeminfo, /v1/heartbeat, /v1/net_info,
 *     /v1/get_img_list, list_names + get_android_detail   (Container API)
 *   - /healthz                                            (proxy, tunnel only)
 *   - host facts over SSH in one round trip               (lib/host.mjs)
 *
 * With `CLOUDFLARE_API_TOKEN` it ALSO checks (read-only) DNS CNAMEs, tunnel
 * health and remote-managed tunnel configs.
 *
 * Exit 0 when our layer is uniform (see lib/render.mjs for what counts),
 * 2 when there is actionable drift, 1 on a fatal error. Touches nothing.
 *
 * Three sources, three levels of trust (25 Sep 2026): the vendor's online
 * reference says what exists; a box's MCP catalogue says what the box believes
 * it serves; only a REST probe on the box says what answers on that CBS line.
 *
 * Usage (from Attila V4/):  node infra/boxes/scripts/check-drift.mjs [--no-ssh]
 */

import { getTunnelRemoteConfig, listDnsRecords, listTunnels, resolveZone } from "./cf-api.mjs";
import { planBox, requireEnv } from "./lib/env.mjs";
import { readHostFacts } from "./lib/host.mjs";
import { manifestBoxes } from "./lib/lan.mjs";
import { renderBox, renderHeader, renderSummary, renderVendorTargets } from "./lib/render.mjs";
import { evaluateBox, fetchBoxes, fetchProvisioning, vendorByModel } from "./lib/vendor.mjs";

const ZONE_NAME = "attila.army";
const NO_SSH = process.argv.includes("--no-ssh");

requireEnv(["CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

async function fetchCloudflare() {
  if (!CF_API_TOKEN) return null;
  try {
    const { zoneId, accountId } = await resolveZone(CF_API_TOKEN, ZONE_NAME);
    const [dns, tunnels] = await Promise.all([listDnsRecords(CF_API_TOKEN, zoneId), listTunnels(CF_API_TOKEN, accountId)]);
    const remoteConfig = new Map();
    await Promise.all(tunnels.map(async (t) => remoteConfig.set(t.id, await getTunnelRemoteConfig(CF_API_TOKEN, accountId, t.id))));
    return { accountId, dnsByName: new Map(dns.map((r) => [r.name, r])), tunnelById: new Map(tunnels.map((t) => [t.id, t])), remoteConfig };
  } catch (err) {
    console.error(`[warn] Cloudflare API check skipped: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log(renderHeader(!!CF_API_TOKEN));
  console.log(renderVendorTargets(vendorByModel));
  console.log("");

  const manifest = manifestBoxes();
  const manifestByHost = new Map(manifest.map((m) => [m.host, m]));
  const [boxes, cfSnap, provisioning] = await Promise.all([fetchBoxes(), fetchCloudflare(), fetchProvisioning()]);

  const rows = [];
  for (const box of boxes) {
    const manifestRow = manifestByHost.get(box.tunnel_hostname) ?? null;
    const plan = await planBox(manifestRow?.num ?? -1, box.tunnel_hostname);
    // SSH facts only for a box that answers, and only where a transport exists.
    let facts = null;
    if (!NO_SSH && manifestRow) {
      const alive = await plan.get("/v1/heartbeat");
      if (alive) facts = await readHostFacts(plan.lanIp ?? manifestRow.sshHost, { viaTunnel: !plan.lanIp });
    }
    rows.push(await evaluateBox({ plan, box, manifestRow, cfSnap, provisioning, facts }));
  }

  for (const r of rows) {
    console.log(renderBox(r, cfSnap));
    console.log("");
  }
  process.exit(renderSummary(rows, provisioning, { noSsh: NO_SSH }));
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
