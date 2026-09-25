const config = require('./config');
const { getContainers } = require('./container-resolver');
const { version } = require('../package.json');

/**
 * GET /healthz
 *
 * Deployed proxy version, stamped from package.json, so the fleet drift
 * checker (infra/boxes/scripts/check-drift.mjs) can verify every box runs the
 * version currently in git — bump package.json on each proxy change.
 *
 * Since 1.3.0 the payload also says WHICH address the proxy talks to and how
 * it found it, because that address is resolved live (api-host.js) and the
 * reconcile worker persists it as the box's observed `lan_ip`. Every field is
 * additive: `status`, `version`, `uptime`, `containers` keep their 1.x shape.
 *
 *   api_host    IPv4 cbs_go is reached on, or null when unresolved
 *   api_iface   interface it was read from (null for an override)
 *   api_source  default_route | iface | override | no_default_route
 *   lan_ip      alias of api_host — the box's address on the LAN it is on
 */
function healthPayload({ ok, containers, error }) {
  const host = config.apiHostResolver.current();
  const base = {
    status: ok ? 'ok' : 'degraded',
    version,
    uptime: process.uptime(),
    api_host: host.host,
    api_iface: host.iface,
    api_source: host.source,
    lan_ip: host.host,
  };
  return ok ? { ...base, containers } : { ...base, error };
}

async function handleHealth(req, res) {
  let payload;
  let code;
  try {
    const containers = await getContainers();
    payload = healthPayload({ ok: true, containers: containers.size });
    code = 200;
  } catch {
    const unresolved = config.apiHost == null;
    payload = healthPayload({ ok: false, error: unresolved ? 'api_unresolved' : 'api_unreachable' });
    code = 503;
  }
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function isHealthCheck(url) {
  return url === config.healthPath;
}

module.exports = { handleHealth, isHealthCheck, healthPayload };
