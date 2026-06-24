const httpProxy = require('http-proxy');
const config = require('./config');
const { resolveStreamTarget, STREAM_TYPES } = require('./container-resolver');
const { handleAudioUpgrade } = require('./audio-bridge');

const wsProxy = httpProxy.createProxyServer({ ws: true });

wsProxy.on('error', (err, req, res) => {
  console.error(`[stream] proxy error: ${err.message}`);
  if (res.writeHead) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'stream_unavailable' }));
  }
});

function parseStreamPath(url) {
  const prefix = config.streamPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = url.match(
    new RegExp(`^${prefix}([^/]+)/(${Object.keys(STREAM_TYPES).join('|')})`)
  );
  if (!match) return null;
  let containerId = match[1];
  try {
    containerId = decodeURIComponent(containerId);
  } catch {
    /* garder brut */
  }
  return { containerId, streamType: match[2] };
}

async function handleStreamUpgrade(req, socket, head) {
  const parsed = parseStreamPath(req.url);
  if (!parsed) {
    socket.destroy();
    return;
  }

  if (parsed.streamType === 'audio') {
    return handleAudioUpgrade(req, socket, head, parsed.containerId);
  }

  try {
    const target = await resolveStreamTarget(parsed.containerId, parsed.streamType);
    if (!target) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    console.log(`[stream] ${parsed.containerId}/${parsed.streamType} → :${target.port}`);
    wsProxy.ws(req, socket, head, {
      target: `ws://${target.host}:${target.port}`,
    });
  } catch (err) {
    console.error(`[stream] resolve error: ${err.message}`);
    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    socket.destroy();
  }
}

function isStreamRequest(url) {
  return url.startsWith(config.streamPrefix);
}

module.exports = { handleStreamUpgrade, isStreamRequest };
