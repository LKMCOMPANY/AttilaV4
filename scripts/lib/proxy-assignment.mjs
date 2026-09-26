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
  const assignments = [...devices]
    .sort((a, b) => (a.user_name ?? a.db_id).localeCompare(b.user_name ?? b.db_id))
    .map((device) => {
      const country = expectedCountry(device);
      // A device already holding a listed proxy of its country keeps it.
      const own = country ? (pool.get(country) ?? []).findIndex((p) => reserved.get(proxyKey(p.host, p.port)) === device.id) : -1;
      const proxy = country ? (own >= 0 ? pool.get(country).splice(own, 1)[0] : pool.get(country)?.shift() ?? null) : null;
      if (country && !proxy) short[country] = (short[country] ?? 0) + 1;
      return { device, proxy, country };
    });
  /** @type {Record<string, number>} */
  const spare = {};
  for (const [country, rest] of pool) if (rest.length) spare[country] = rest.length;
  return { assignments, spare, short, reserved: reservedCount };
}
