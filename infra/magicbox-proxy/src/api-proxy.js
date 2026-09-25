const httpProxy = require('http-proxy');
const config = require('./config');

// The target is passed PER REQUEST: cbs_go's address is resolved live (see
// api-host.js), so a target frozen at startup would go stale the first time a
// DHCP lease moved — which is how box-4 was lost on 25 September 2026.
const apiProxy = httpProxy.createProxyServer({ xfwd: true });

apiProxy.on('error', (err, req, res) => {
  console.error(`[api] proxy error: ${err.message}`);
  // A connect error a moved address would explain triggers a re-resolution
  // so the NEXT request already goes to the right place.
  if (config.apiHostResolver.refreshOnError(err)) {
    console.warn(`[api] re-resolved API host after ${err.code} → ${config.apiHost ?? 'none'}`);
  }
  if (res && res.writeHead && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'api_unavailable' }));
  } else if (res && typeof res.destroy === 'function') {
    res.destroy();
  }
});

function noRoute(res) {
  res.writeHead(503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'api_unresolved' }));
}

function handleApiRequest(req, res) {
  const target = config.apiBase();
  if (!target) return noRoute(res);
  apiProxy.web(req, res, { target });
}

function handleApiUpgrade(req, socket, head) {
  const target = config.apiBase();
  if (!target) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    socket.destroy();
    return;
  }
  apiProxy.ws(req, socket, head, { target });
}

module.exports = { handleApiRequest, handleApiUpgrade };
