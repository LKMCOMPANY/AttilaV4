/**
 * What a boot-health sweep row means for a human — pure, tested. The I/O
 * (reading reports, opening attention items) is `record-sweep-attention.ts`.
 *
 *   dead / unstable device            → boot_dead        (critical)
 *   guest leaves through the box IP   → proxy_incoherent (critical — a leak)
 *   proxy configured, not routing     → proxy_incoherent (warning)
 *   proxy exits in the wrong country  → proxy_incoherent (warning)
 */

/**
 * @typedef {{ reason: "boot_dead" | "proxy_incoherent", severity: "critical" | "warning", title: string, detail: string }} Finding
 * @typedef {{ ip: string, country: string, city?: string }} Exit
 * @typedef {{ tag: string, detail: string, geo?: { exit: Exit | null, expected: string | null, coherent: boolean } }} Routing
 * @typedef {{ config: { status: string, detail?: string }, routing: Routing | null }} ProxyProbe
 * @typedef {{ box: string, db_id: string, user_name: string | null, health: "healthy" | "unstable" | "dead", boot_ms: number | null, note: string | null, proxy: ProxyProbe | null }} SweepRow
 * @typedef {{ row: SweepRow, finding: Finding }} Planned
 */

/**
 * The findings one sweep row justifies.
 * @param {SweepRow} row
 * @returns {Finding[]}
 */
export function findingsFor(row) {
  const name = row.user_name ?? row.db_id;
  /** @type {Finding[]} */
  const out = [];
  if (row.health !== "healthy") {
    out.push({ reason: "boot_dead", severity: "critical", title: `Device ${name} does not boot`, detail: `${row.health}: ${row.note ?? "no boot_completed"}` });
  }
  const proxy = row.proxy;
  if (!proxy || proxy.config.status !== "proxied") return out;
  const routing = proxy.routing;
  if (routing?.tag === "UNPROXIED") {
    out.push({
      reason: "proxy_incoherent",
      severity: "critical",
      title: `${name} leaves through the box's own address`,
      detail: `${proxy.config.detail}: guest egress ${routing.geo?.exit?.ip ?? "?"} = box WAN — the proxy is not applied`,
    });
  } else if (routing && routing.tag !== "ROUTES") {
    const what = routing.tag === "no-engine"
      ? "no host-side engine and the box's proxy is older than 1.3.1 — re-probe after the redeploy"
      : `proxy not routing (${routing.tag}: ${routing.detail})`;
    out.push({ reason: "proxy_incoherent", severity: "warning", title: `Proxy of ${name} is not in service`, detail: `${proxy.config.detail}: ${what}` });
  } else if (routing?.geo && !routing.geo.coherent && routing.geo.exit) {
    out.push({
      reason: "proxy_incoherent",
      severity: "warning",
      title: `Proxy of ${name} exits in ${routing.geo.exit.country}, persona is ${routing.geo.expected}`,
      detail: `${proxy.config.detail} → ${routing.geo.exit.country}/${routing.geo.exit.city ?? "?"} (${routing.geo.exit.ip}); expected ${routing.geo.expected}`,
    });
  }
  return out;
}

/**
 * Group the proxy findings per box; a box over `boxThreshold` gets one
 * box-scoped entry (its devices listed) instead of one item per device — a
 * systemic problem is one ticket, not a flood (box-3, 26 September 2026: 85).
 * Boot findings are always per device.
 * @param {SweepRow[]} rows
 * @param {number} boxThreshold
 * @returns {{ perDevice: Planned[], perBox: { box: string, findings: Planned[] }[] }}
 */
export function planFindings(rows, boxThreshold) {
  /** @type {Planned[]} */
  const perDevice = [];
  /** @type {Map<string, Planned[]>} */
  const proxyByBox = new Map();
  for (const row of rows) {
    for (const finding of findingsFor(row)) {
      if (finding.reason !== "proxy_incoherent") {
        perDevice.push({ row, finding });
        continue;
      }
      if (!proxyByBox.has(row.box)) proxyByBox.set(row.box, []);
      proxyByBox.get(row.box).push({ row, finding });
    }
  }
  /** @type {{ box: string, findings: Planned[] }[]} */
  const perBox = [];
  for (const [box, findings] of proxyByBox) {
    if (findings.length > boxThreshold) perBox.push({ box, findings });
    else perDevice.push(...findings);
  }
  return { perDevice, perBox };
}
