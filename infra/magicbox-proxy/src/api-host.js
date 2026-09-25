const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');

/**
 * Where does cbs_go listen?
 *
 * On the VMOS hosts `cbs_go` binds :18182 on the LAN address ONLY — never on
 * 127.0.0.1 — and the boxes are on DHCP, so that address changes whenever a
 * box is plugged into another office. Writing it into a config file is what
 * took box-4 down on 25 September 2026 (`API_HOST=192.168.1.16` after the
 * lease had moved to .237 → `EHOSTUNREACH` on every request, `/healthz` 503).
 *
 * The right source is the interface carrying the default route: that is the
 * address `/v1/net_info` reports as `host_ip`, and it is the only one of the
 * host's several non-internal IPv4s (docker0 172.17.0.1, a `mac0` macvlan
 * alias with a second LAN address) that cbs_go actually uses.
 */

const PROC_NET_ROUTE = '/proc/net/route';
const REFRESH_ERROR_CODES = new Set(['EHOSTUNREACH', 'ECONNREFUSED', 'ENETUNREACH', 'EADDRNOTAVAIL', 'ETIMEDOUT']);

/**
 * Name of the interface that carries the default route, from `/proc/net/route`
 * (Destination 00000000, RTF_GATEWAY set). Lowest metric wins; `null` when
 * there is no default route.
 */
function defaultRouteInterface(routeTable) {
  const table = routeTable != null ? routeTable : safeRead(PROC_NET_ROUTE);
  if (!table) return null;
  let best = null;
  for (const line of table.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 8) continue;
    const [iface, destination, , flags, , , metric] = cols;
    const isDefault = destination === '00000000';
    const isUp = (parseInt(flags, 16) & 0x1) === 0x1; // RTF_UP
    if (!isDefault || !isUp) continue;
    const m = parseInt(metric, 10) || 0;
    if (!best || m < best.metric) best = { iface, metric: m };
  }
  return best ? best.iface : null;
}

/** First external IPv4 of a named interface, or `null`. */
function addressOf(iface, interfaces) {
  const table = interfaces || os.networkInterfaces();
  for (const entry of table[iface] || []) {
    if ((entry.family === 'IPv4' || entry.family === 4) && !entry.internal) return entry.address;
  }
  return null;
}

/**
 * Resolve the API host once.
 *
 *   override    API_HOST set — honoured verbatim, but it is the footgun
 *               described above, so it is reported as such.
 *   iface       API_IFACE set — the named interface's IPv4.
 *   default     the default-route interface's IPv4 (the normal case).
 *
 * Never falls back to 127.0.0.1: cbs_go does not listen there, and a wrong
 * address that "resolves" hides the fault instead of surfacing it. A `null`
 * host means "no route", and /healthz says so.
 */
function resolveApiHost({ override, iface, routeTable, interfaces } = {}) {
  if (override) return { host: override, iface: null, source: 'override' };
  const table = interfaces || os.networkInterfaces();
  if (iface) {
    return { host: addressOf(iface, table), iface, source: 'iface' };
  }
  const route = defaultRouteInterface(routeTable);
  if (!route) return { host: null, iface: null, source: 'no_default_route' };
  return { host: addressOf(route, table), iface: route, source: 'default_route' };
}

/** Is this error one that a changed address would explain? */
function shouldRefreshOn(err) {
  return !!(err && REFRESH_ERROR_CODES.has(err.code));
}

/**
 * Live resolver: keeps the current answer, re-resolves on demand (after a
 * connect error that a moved address would explain) and on a timer (an
 * address that changed with no traffic to reveal it). Emits `change` with
 * `{ previous, current }` so the log tells the story.
 */
class ApiHostResolver extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.state = resolveApiHost(options);
    this.timer = null;
    this.lastRefreshAt = 0;
    this.minRefreshIntervalMs = options.minRefreshIntervalMs ?? 2000;
  }

  current() {
    return this.state;
  }

  /** Re-resolve now (rate-limited); returns the current state. */
  refresh(reason = 'manual') {
    const now = Date.now();
    if (now - this.lastRefreshAt < this.minRefreshIntervalMs) return this.state;
    this.lastRefreshAt = now;
    const previous = this.state;
    const current = resolveApiHost(this.options);
    if (current.host !== previous.host || current.iface !== previous.iface) {
      this.state = current;
      this.emit('change', { previous, current, reason });
    }
    return this.state;
  }

  /** Refresh if `err` is a connect error a moved address would explain. */
  refreshOnError(err) {
    if (!shouldRefreshOn(err)) return false;
    this.refresh(err.code);
    return true;
  }

  start(intervalMs = 15000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.refresh('timer'), intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

module.exports = {
  ApiHostResolver,
  defaultRouteInterface,
  addressOf,
  resolveApiHost,
  shouldRefreshOn,
  REFRESH_ERROR_CODES,
};
