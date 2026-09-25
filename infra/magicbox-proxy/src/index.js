const http = require('http');
const config = require('./config');
const { handleApiRequest, handleApiUpgrade } = require('./api-proxy');
const { handleStreamUpgrade, isStreamRequest } = require('./stream-handler');
const { handleHealth, isHealthCheck } = require('./health');
const { handleProxyTest, isProxyTest } = require('./proxy-test');
const { handleStreamReady, isStreamReady } = require('./stream-ready');

const server = http.createServer((req, res) => {
  if (isHealthCheck(req.url)) {
    return handleHealth(req, res);
  }
  if (isStreamReady(req.url)) {
    return handleStreamReady(req, res);
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

// The API host is resolved live: log every change so the journal explains a
// box that moved between two offices, and keep a slow timer running so an
// address that changed with no traffic to reveal it is still picked up.
const resolver = config.apiHostResolver;
resolver.on('change', ({ previous, current, reason }) => {
  console.warn(
    `[proxy] API host ${previous.host ?? 'none'} → ${current.host ?? 'none'}` +
      ` (${current.source}${current.iface ? ` ${current.iface}` : ''}, trigger: ${reason})`,
  );
});
resolver.start(config.apiHostRefreshMs);

server.listen(config.port, '127.0.0.1', () => {
  const host = resolver.current();
  console.log(`[proxy] listening on 127.0.0.1:${config.port}`);
  console.log(
    `[proxy] API → ${host.host ?? 'UNRESOLVED'}:${config.apiPort}` +
      ` (${host.source}${host.iface ? ` via ${host.iface}` : ''})`,
  );
  console.log(`[proxy] streams → ${config.streamPrefix}{container_id}/{video|touch|audio}`);
  console.log(`[proxy] stream ready → ${config.streamReadyPrefix}{db_id}`);
  console.log(`[proxy] proxy test → ${config.proxyTestPrefix}{db_id}`);
});

process.on('uncaughtException', (err) => {
  console.error(`[proxy] uncaught exception: ${err.message}`);
});

process.on('unhandledRejection', (err) => {
  console.error(`[proxy] unhandled rejection: ${err.message}`);
});
