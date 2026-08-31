const os = require('os');

function detectLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const lanIp = process.env.API_HOST || detectLanIp();

const config = {
  port: parseInt(process.env.PROXY_PORT, 10) || 8080,
  apiHost: lanIp,
  apiPort: parseInt(process.env.API_PORT, 10) || 18182,
  streamHost: '127.0.0.1',
  streamPrefix: '/stream/',
  // Readiness probe: complete a WebSocket handshake against the scrcpy video
  // port, and separately ask the in-guest v2 agent whether Android is up. A
  // plain TCP connect is not enough — the host-side forward stays bound after
  // the in-container scrcpy dies, which is exactly the "zombie" device.
  streamReadyPrefix: '/stream-ready/',
  streamReadyTimeoutMs: parseInt(process.env.STREAM_READY_TIMEOUT_MS, 10) || 1500,
  healthPath: '/healthz',

  // --- Proxy connectivity test (mihomo delay) ---
  // Directory where cbs_go stores per-container mihomo configs
  // (`<dbId>/mihomo.json` holds the external-controller + secret + node).
  cbsStateDir:
    process.env.CBS_STATE_DIR ||
    '/root/armcloud-container-backend-service/state',
  proxyTestPrefix: '/proxy-test/',
  // Stateless, cookieless 204 endpoint — used by mihomo to time the proxy.
  proxyTestUrl: process.env.PROXY_TEST_URL || 'http://cp.cloudflare.com/generate_204',
  proxyTestTimeoutMs: parseInt(process.env.PROXY_TEST_TIMEOUT_MS, 10) || 8000,
};

module.exports = config;
