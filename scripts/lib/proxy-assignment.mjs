/**
 * Pure half of the proxy migration (`scripts/assign-proxies.ts`): read the
 * operator's proxy list and give every device one proxy of its persona's
 * country. Tested; no I/O here.
 *
 * @typedef {{ country: string, host: string, port: number, username: string, password: string, city?: string }} ProxyRow
 * @typedef {{ id: string, db_id: string, user_name: string | null, country?: string | null }} DeviceLike
 * @typedef {{ device: DeviceLike, proxy: ProxyRow | null, country: string | null }} Assignment
 */

import { expectedCountry } from "./proxy-verdict.mjs";

const REQUIRED_COLUMNS = ["country", "host", "port", "username", "password"];

/**
 * Strict CSV with a header line: `country,host,port,username,password[,city]`.
 * Comma-separated, no quoting (none of these fields carries a comma), `#`
 * lines ignored. Throws on the first malformed line so a bad list is refused
 * whole, never applied in part.
 * @param {string} text
 * @returns {ProxyRow[]}
 */
export function parseProxyCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const header = (lines.shift() ?? "").split(",").map((h) => h.trim().toLowerCase());
  for (const required of REQUIRED_COLUMNS) {
    if (!header.includes(required)) throw new Error(`CSV header misses "${required}" (got: ${header.join(",")})`);
  }
  const col = (name) => header.indexOf(name);
  const seen = new Set();
  return lines.map((line, i) => {
    const cells = line.split(",").map((c) => c.trim());
    const port = Number(cells[col("port")]);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`line ${i + 2}: bad port "${cells[col("port")]}"`);
    const country = (cells[col("country")] ?? "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new Error(`line ${i + 2}: bad country "${country}"`);
    const host = cells[col("host")];
    const username = cells[col("username")];
    const password = cells[col("password")];
    if (!host || !username || !password) throw new Error(`line ${i + 2}: host, username and password are required`);
    const key = `${host}:${port}:${username}`;
    if (seen.has(key)) throw new Error(`line ${i + 2}: duplicate proxy ${host}:${port} for ${username}`);
    seen.add(key);
    const city = col("city") >= 0 ? cells[col("city")] || undefined : undefined;
    return { country, host, port, username, password, city };
  });
}

/** `host:port` — the identity of a dedicated proxy. */
export function proxyKey(host, port) {
  return `${host}:${port}`;
}

/**
 * Gateways hand out a session per username on one shared `host:port`
 * (NodeMaven: the `sid-…` in the account) — the port is no identity there,
 * so a gateway holding is neither reserved nor contested. The list of hosts
 * is the one place this provider knowledge lives.
 */
const GATEWAY_HOSTS = new Set(["gate.nodemaven.com"]);
function isGatewayProxy(host) {
  return GATEWAY_HOSTS.has(String(host ?? "").toLowerCase());
}

/**
 * Who holds what, from the DB mirror (`devices.proxy_*`, every box), for the
 * planner's reservations. One holder per key: a dedicated IP with two devices
 * on it is CONTESTED — the same list handed out twice while a box was away.
 *
 * The holder that keeps a contested key: the first, in `holders` order (the
 * fetch sorts by `user_name`), among those `reclaim` does not name; if
 * `reclaim` names them all, the first of them. A holding nobody contests is
 * kept whatever `reclaim` says — a port a box holds alone is its own.
 * `reclaimed` counts the holders that lost their key; `contested` lists the
 * keys that had more than one holder, for the operator to read.
 * @template {Holder} H
 * @param {H[]} holders
 * @param {{ reclaim?: (holder: H) => boolean }} [options]
 * @returns {{ reserved: Map<string, string>, reclaimed: number, contested: Map<string, H[]> }}
 * @typedef {{ id: string, proxy_host: string | null, proxy_port: number | null }} Holder
 */
export function reserveProxies(holders, { reclaim = () => false } = {}) {
  /** @type {Map<string, H[]>} */
  const byKey = new Map();
  for (const h of holders) {
    if (!h.proxy_host || !h.proxy_port || isGatewayProxy(h.proxy_host)) continue;
    const key = proxyKey(h.proxy_host, h.proxy_port);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(h);
  }
  const reserved = new Map();
  const contested = new Map();
  let reclaimed = 0;
  for (const [key, list] of byKey) {
    const keeper = list.find((h) => !reclaim(h)) ?? list[0];
    reserved.set(key, keeper.id);
    if (list.length > 1) contested.set(key, list);
    reclaimed += list.filter((h) => h !== keeper && reclaim(h)).length;
  }
  return { reserved, reclaimed, contested };
}

/**
 * One proxy per device, by the persona's country, in `user_name` order so a
 * re-run with the same list gives the same device the same proxy. Devices
 * whose country has no proxy left are returned with `proxy: null`.
 *
 * `reserved` (`host:port` keys) are proxies another device already holds:
 * a dedicated IP shared by two devices ties two accounts together, so those
 * are never handed out — a device keeps its own proxy if it is in the list.
 * @template {DeviceLike} D
 * @param {D[]} devices
 * @param {ProxyRow[]} proxies
 * @param {{ reserved?: Map<string, string> }} [options] reserved: proxy key → holder device id
 * @returns {{ assignments: { device: D, proxy: ProxyRow | null, country: string | null }[], spare: Record<string, number>, short: Record<string, number>, reserved: number }}
 */
export function planAssignments(devices, proxies, { reserved = new Map() } = {}) {
  const deviceIds = new Set(devices.map((d) => d.id));
  /** @type {Map<string, ProxyRow[]>} */
  const pool = new Map();
  let reservedCount = 0;
  for (const p of proxies) {
    const holder = reserved.get(proxyKey(p.host, p.port));
    if (holder && !deviceIds.has(holder)) {
      reservedCount++;
      continue;
    }
    if (!pool.has(p.country)) pool.set(p.country, []);
    pool.get(p.country).push(p);
  }
  /** @type {Record<string, number>} */
  const short = {};
  const holderOf = (p) => reserved.get(proxyKey(p.host, p.port));
  /** Take the device's own proxy if it holds one of its country, else the first one nobody holds. */
  const take = (list, device) => {
    const own = list.findIndex((p) => holderOf(p) === device.id);
    const i = own >= 0 ? own : list.findIndex((p) => !holderOf(p));
    return i >= 0 ? list.splice(i, 1)[0] : null;
  };
  const assignments = [...devices]
    .sort((a, b) => (a.user_name ?? a.db_id).localeCompare(b.user_name ?? b.db_id))
    .map((device) => {
      const country = expectedCountry(device);
      // A proxy held by another device in scope is that device's — it keeps it
      // at its own turn, whatever the sort order; nobody else gets it.
      const proxy = country ? take(pool.get(country) ?? [], device) : null;
      if (country && !proxy) short[country] = (short[country] ?? 0) + 1;
      return { device, proxy, country };
    });
  /** @type {Record<string, number>} */
  const spare = {};
  for (const [country, rest] of pool) {
    const free = rest.filter((p) => !holderOf(p)).length;
    if (free) spare[country] = free;
  }
  return { assignments, spare, short, reserved: reservedCount };
}
