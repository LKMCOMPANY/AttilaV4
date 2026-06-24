const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// db_ids are uppercase alphanumeric (e.g. EDGE2DD6WZJU1251). Strict whitelist
// — it is interpolated into a filesystem path, so anything else is rejected.
const DB_ID_RE = /^[A-Z0-9]+$/;

function isProxyTest(url) {
  return url.startsWith(config.proxyTestPrefix);
}

function parseDbId(url) {
  const rest = url.slice(config.proxyTestPrefix.length);
  const raw = rest.split(/[/?]/)[0];
  let dbId = raw;
  try {
    dbId = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  return dbId;
}

/**
 * Read the per-container mihomo config written by cbs_go and extract what is
 * needed to query its REST controller: the controller address, the auth
 * secret, and the upstream proxy node name.
 */
function readMihomo(dbId) {
  const file = path.join(config.cbsStateDir, dbId, 'mihomo.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const node =
    Array.isArray(cfg.proxies) && cfg.proxies[0] ? cfg.proxies[0].name : null;
  return {
    controller: cfg['external-controller'] || null,
    secret: cfg.secret || '',
    node,
  };
}

/**
 * Ask mihomo to time a request to a neutral 204 endpoint THROUGH the upstream
 * proxy node. This is the only reliable proxy-connectivity signal: it exits
 * via the real upstream and fails when the upstream is blocked/down.
 */
function delayTest({ controller, secret, node }) {
  return new Promise((resolve, reject) => {
    const url =
      `http://${controller}/proxies/${encodeURIComponent(node)}/delay` +
      `?timeout=${config.proxyTestTimeoutMs}&url=${encodeURIComponent(config.proxyTestUrl)}`;
    const req = http.get(
      url,
      { headers: secret ? { Authorization: `Bearer ${secret}` } : {} },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(body); } catch { /* non-JSON */ }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(config.proxyTestTimeoutMs + 4000, () => {
      req.destroy();
      reject(new Error('controller timeout'));
    });
  });
}

async function handleProxyTest(req, res) {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  const dbId = parseDbId(req.url);
  if (!DB_ID_RE.test(dbId)) {
    return send(400, { ok: false, error: 'invalid_db_id' });
  }

  let info;
  try {
    info = readMihomo(dbId);
  } catch {
    // No mihomo.json → the device has never been provisioned with a proxy
    // engine (or the state dir differs). Treated as "not provisioned".
    return send(404, { ok: false, error: 'proxy_not_provisioned' });
  }
  if (!info.controller || !info.node) {
    return send(502, { ok: false, error: 'mihomo_config_incomplete' });
  }

  try {
    const { json } = await delayTest(info);
    if (json && typeof json.delay === 'number') {
      return send(200, { ok: true, delayMs: json.delay });
    }
    return send(200, { ok: false, error: (json && json.message) || 'unreachable' });
  } catch (err) {
    // ECONNREFUSED here means mihomo isn't listening → container stopped /
    // proxy engine down rather than a genuine upstream failure.
    const stopped = /ECONNREFUSED|timeout/i.test(err.message);
    return send(stopped ? 503 : 502, {
      ok: false,
      error: stopped ? 'engine_unreachable' : err.message,
    });
  }
}

module.exports = { isProxyTest, handleProxyTest };
