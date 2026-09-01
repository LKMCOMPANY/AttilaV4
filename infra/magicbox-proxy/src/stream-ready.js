const net = require('net');
const http = require('http');
const crypto = require('crypto');
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
 * Does the scrcpy WebSocket server actually speak?
 *
 * A plain TCP connect is NOT enough and used to be this endpoint's whole test.
 * The host-side port stays bound by the VMOS port forward even after the
 * in-container scrcpy process dies, so `connect()` succeeds against a dead
 * stack and the client then eats a 502 on upgrade — the "zombie" devices
 * operators had to fix by restarting the entire container.
 *
 * Completing the handshake (HTTP 101) proves the server is alive and willing.
 */
function probeScrcpyHandshake(host, port) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.connect({ host, port });

    const done = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(config.streamReadyTimeoutMs);
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));

    socket.once('connect', () => {
      const key = crypto.randomBytes(16).toString('base64');
      socket.write(
        'GET / HTTP/1.1\r\n' +
          `Host: ${host}:${port}\r\n` +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\n` +
          'Sec-WebSocket-Version: 13\r\n' +
          '\r\n'
      );
    });

    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      // The status line is all we need, and it arrives in the first packet.
      const lineEnd = buffer.indexOf('\r\n');
      if (lineEnd === -1) {
        if (buffer.length > 512) done(false);
        return;
      }
      done(/^HTTP\/1\.[01] 101/.test(buffer.slice(0, lineEnd)));
    });
  });
}

/**
 * Does the in-guest Android control service answer?
 *
 * This is the other half of the diagnosis. The v2 agent lives INSIDE Android,
 * so a reply proves the OS is up regardless of the projection stack. Available
 * on every image in the fleet (agent 1.1.1+ — `base/version_info` predates
 * both). Failure here is not fatal on its own: older images may not carry the
 * agent, in which case we simply fall back to the handshake verdict.
 */
function probeAgent(dbId) {
  return new Promise((resolve) => {
    const req = http.get(
      `http://${config.apiHost}:${config.apiPort}/android_api/v2/${dbId}/base/version_info`,
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            // VMOS answers 200 with `code: 0` and a "not running" msg when the
            // container is down; a live agent answers `code: 200`.
            resolve(JSON.parse(body)?.code === 200);
          } catch {
            resolve(false);
          }
        });
      }
    );
    req.on('error', () => resolve(false));
    req.setTimeout(config.streamReadyTimeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * GET /stream-ready/{db_id}
 *   → { ready: boolean, reason: string, agent?: boolean, projection?: boolean }
 *
 * `reason` tells the caller WHICH remedy applies instead of leaving it to guess:
 *
 *   ready            both alive — stream away
 *   projection_dead  Android answers, scrcpy does not. A definite fault: the
 *                    projection service needs restarting, and no amount of
 *                    waiting will change it.
 *   android_down     neither answers though the container is listed. AMBIGUOUS
 *                    on purpose — a device 20 s into a 40 s boot looks exactly
 *                    like a dead one from here. Callers must keep polling this
 *                    one; only `projection_dead` is safe to treat as terminal.
 *   not_listed       no container / no port yet → stopped or very early boot
 *   resolve_failed   the VMOS API itself is unreachable
 *
 * Always 200 for the not-yet-streamable cases so clients can poll without
 * treating them as hard failures; 400 only for a malformed db_id.
 */
async function handleStreamReady(req, res) {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  const dbId = parseDbId(req.url);
  if (!DB_ID_RE.test(dbId)) {
    return send(400, { ready: false, reason: 'invalid_db_id' });
  }

  let target;
  try {
    target = await resolveStreamTarget(dbId, 'video');
  } catch {
    // VMOS API unreachable — report not-ready so the client keeps polling
    // rather than tearing down with an error.
    return send(200, { ready: false, reason: 'resolve_failed' });
  }

  if (!target) {
    // Container absent from the list (stopped/booting) or no tcp_port yet.
    return send(200, { ready: false, reason: 'not_listed' });
  }

  // Handshake first, agent only if it fails. A device that streams is the
  // common case and this endpoint is polled once a second per connecting
  // client — no reason to ask Android anything when scrcpy already answered.
  if (await probeScrcpyHandshake(target.host, target.port)) {
    return send(200, { ready: true, reason: 'ready', projection: true });
  }

  const agent = await probeAgent(dbId);
  return send(200, {
    ready: false,
    reason: agent ? 'projection_dead' : 'android_down',
    agent,
    projection: false,
  });
}

module.exports = { isStreamReady, handleStreamReady };
