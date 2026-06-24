const http = require('http');
const config = require('./config');
const { handleApiRequest, handleApiUpgrade } = require('./api-proxy');
const { handleStreamUpgrade, isStreamRequest } = require('./stream-handler');
const { handleHealth, isHealthCheck } = require('./health');
const { handleProxyTest, isProxyTest } = require('./proxy-test');

const server = http.createServer((req, res) => {
  if (isHealthCheck(req.url)) {
    return handleHealth(req, res);
  }
  if (isProxyTest(req.url)) {
    return handleProxyTest(req, res);
  }
  handleApiRequest(req, res);
});

server.on('upgrade', (req, socket, head) => {
  if (isStreamRequest(req.url)) {
    return handleStreamUpgrade(req, socket, head);
  }
  handleApiUpgrade(req, socket, head);
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`[proxy] listening on 127.0.0.1:${config.port}`);
  console.log(`[proxy] API → ${config.apiHost}:${config.apiPort}`);
  console.log(`[proxy] streams → ${config.streamPrefix}{container_id}/{video|touch|audio}`);
  console.log(`[proxy] proxy test → ${config.proxyTestPrefix}{db_id}`);
});

process.on('uncaughtException', (err) => {
  console.error(`[proxy] uncaught exception: ${err.message}`);
});

process.on('unhandledRejection', (err) => {
  console.error(`[proxy] unhandled rejection: ${err.message}`);
});
