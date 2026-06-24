const httpProxy = require('http-proxy');
const config = require('./config');

const apiProxy = httpProxy.createProxyServer({
  target: `http://${config.apiHost}:${config.apiPort}`,
  xfwd: true,
});

apiProxy.on('error', (err, req, res) => {
  console.error(`[api] proxy error: ${err.message}`);
  if (res.writeHead) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'api_unavailable' }));
  }
});

function handleApiRequest(req, res) {
  apiProxy.web(req, res);
}

function handleApiUpgrade(req, socket, head) {
  apiProxy.ws(req, socket, head);
}

module.exports = { handleApiRequest, handleApiUpgrade };
