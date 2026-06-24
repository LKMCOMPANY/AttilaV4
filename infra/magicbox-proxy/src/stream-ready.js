const net = require('net');
const config = require('./config');
const { resolveStreamTarget } = require('./container-resolver');

// db_ids are uppercase alphanumeric (e.g. EDGE2DD6WZJU1251). Strict whitelist
// to mirror proxy-test.js and avoid feeding anything unexpected downstream.
const DB_ID_RE = /^[A-Z0-9]+$/;

function isStreamReady(url) {
  return url.startsWith(config.streamReadyPrefix);
}

function parseDbId(url) {
  const rest = url.slice(config.streamReadyPrefix.length);
  const raw = rest.split(/[/?]/)[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Open a short-lived TCP connection to the scrcpy video port. A successful
 * connect means the in-container scrcpy server is bound and accepting — i.e.
 * the device is genuinely streamable. A refused/timed-out connect means it is
 * still warming up (Android boots ~10–25s, occasionally up to ~90s).
 */
function probe(host, port) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.connect({ host, port });

    const done = (ready) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ready);
    };

    socket.setTimeout(config.streamReadyTimeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * GET /stream-ready/{db_id} → { ready: boolean, error?: string }
 *
 * Always 200 for the "not yet streamable" case so the client can poll without
 * treating it as a hard failure; 400 only for a malformed db_id.
 */
async function handleStreamReady(req, res) {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  const dbId = parseDbId(req.url);
  if (!DB_ID_RE.test(dbId)) {
    return send(400, { ready: false, error: 'invalid_db_id' });
  }

  let target;
  try {
    target = await resolveStreamTarget(dbId, 'video');
  } catch {
    // VMOS API unreachable — report not-ready so the client keeps polling
    // rather than tearing down with an error.
    return send(200, { ready: false, error: 'resolve_failed' });
  }

  if (!target) {
    // Container absent from the list (stopped/booting) or no tcp_port yet.
    return send(200, { ready: false, error: 'not_listed' });
  }

  const ready = await probe(target.host, target.port);
  return send(200, { ready });
}

module.exports = { isStreamReady, handleStreamReady };
