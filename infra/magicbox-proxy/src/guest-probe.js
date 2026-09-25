const http = require('http');
const https = require('https');
const config = require('./config');

/**
 * The proxy verdict when the engine runs INSIDE the guest.
 *
 * Measured on box-3, 26 September 2026: 60 of 126 containers carry their proxy
 * as an in-guest `clash` process on a `Meta` TUN interface (198.18.0.1/30,
 * policy routing — the "vpn" mode), so cbs_go writes no
 * `state/<dbId>/mihomo.json` on the host and the host-side delay test answered
 * `proxy_not_provisioned` for devices that were, in fact, fully proxied
 * (US30: box WAN 145.224.95.86, guest egress 151.241.63.63 London).
 *
 * The only honest probe for that mode is a request made FROM the guest: its
 * exit IP is the proxy's exit — or the box's own WAN address, which is the
 * one verdict that matters (`unproxied`). The WAN address is read once an
 * hour from the host itself.
 *
 * Timing, measured on CA2 (box-3) the same night: at `sys.boot_completed`
 * the clash process exists but its TUN has no address and no rule, and the
 * guest egresses through the box (145.224.95.86); 20 s later the TUN is up
 * and the egress is the proxy's (82.26.244.28). A host-side engine (US23,
 * box-2) routes from +0 s. So an in-guest engine that is present but not yet
 * routing is `engine_starting` — poll — not `unproxied`.
 */

const WAN_REFRESH_MS = 60 * 60 * 1000;
let wanCache = { at: 0, ip: null };

function fetchJson(url, { timeoutMs, method = 'GET', body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* keep null */ }
        resolve({ status: res.statusCode, json, text: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

/** The box's own public address, cached an hour; null when it cannot be read. */
async function boxWanIp() {
  if (wanCache.ip && Date.now() - wanCache.at < WAN_REFRESH_MS) return wanCache.ip;
  try {
    const { text } = await fetchJson(config.wanIpUrl, { timeoutMs: config.proxyTestTimeoutMs });
    const ip = text.trim();
    if (/^[0-9a-fA-F.:]+$/.test(ip)) wanCache = { at: Date.now(), ip };
  } catch { /* keep the previous value, if any */ }
  return wanCache.ip;
}

/** Run one shell command in the guest through cbs_go; null when the container cannot be asked. */
async function guestShell(dbId, cmd) {
  const base = config.apiBase();
  if (!base) return null;
  try {
    const { json } = await fetchJson(`${base}/android_api/v1/shell/${dbId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: dbId, cmd }),
      timeoutMs: config.proxyTestTimeoutMs + 6000,
    });
    if (!json || json.code !== 200) return null;
    return String(json.data && json.data.message ? json.data.message : '');
  } catch {
    return null;
  }
}

/**
 * Is there an in-guest engine, and is its TUN routing yet?
 * Returns `{ engine: boolean, routing: boolean }`, or null when the guest cannot be asked.
 */
async function guestEngineState(dbId) {
  const out = await guestShell(dbId, 'ps -A | grep -ciE "[c]lash|[m]ihomo"; ip rule | grep -c Meta');
  if (out === null) return null;
  const [procs, rules] = out.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0);
  return { engine: procs > 0, routing: rules > 0 };
}

/**
 * Where the guest comes out, timed. Returns one of:
 *   { ok: true,  delayMs, engine: 'guest', exit: { ip, country, city } }
 *   { ok: false, error: 'engine_starting', engine: 'guest' }    — clash is up, its TUN is not routing yet: poll
 *   { ok: false, error: 'unproxied',   engine: 'guest', exit }   — exits through the box's WAN address
 *   { ok: false, error: 'unreachable', engine: 'guest' }         — the guest could not reach the internet
 *   null                                                          — the container could not be asked
 */
async function probeGuestExit(dbId) {
  const started = Date.now();
  const state = await guestEngineState(dbId);
  if (state === null) return null;
  if (state.engine && !state.routing) return { ok: false, error: 'engine_starting', engine: 'guest' };
  const out = await guestShell(dbId, `curl -s -m ${Math.round(config.proxyTestTimeoutMs / 1000)} ${config.guestExitUrl}`);
  if (out === null) return null;
  let body = null;
  try { body = JSON.parse(out.trim()); } catch { /* unreadable */ }
  if (!body || !body.ip) return { ok: false, error: 'unreachable', engine: 'guest' };
  const exit = { ip: body.ip, country: body.country || null, city: body.city || null };
  const wan = await boxWanIp();
  if (wan && wan === exit.ip) return { ok: false, error: 'unproxied', engine: 'guest', exit };
  return { ok: true, delayMs: Date.now() - started, engine: 'guest', exit };
}

/** Test seam: forget the cached WAN address. */
function resetWanCache() {
  wanCache = { at: 0, ip: null };
}

module.exports = { probeGuestExit, boxWanIp, resetWanCache };
