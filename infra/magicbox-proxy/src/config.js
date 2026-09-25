const { ApiHostResolver } = require('./api-host');

// The address cbs_go listens on is RESOLVED, not configured: the IPv4 of the
// default-route interface, re-resolved after a connect error and on a timer.
// See api-host.js for why. `API_HOST` survives only as an explicit override
// for a host with an exotic routing table — it is the setting that broke
// box-4 when its DHCP lease moved, so leave it unset on the fleet.
const apiHost = new ApiHostResolver({
  override: process.env.API_HOST || undefined,
  iface: process.env.API_IFACE || undefined,
});

const config = {
  port: parseInt(process.env.PROXY_PORT, 10) || 8080,
  apiHost: null, // live getter, defined below
  apiHostResolver: apiHost,
  apiPort: parseInt(process.env.API_PORT, 10) || 18182,
  apiHostRefreshMs: parseInt(process.env.API_HOST_REFRESH_MS, 10) || 15000,
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

// Every module reads `config.apiHost` at call time and therefore follows a
// re-resolution without being told. `null` when the host has no default route.
Object.defineProperty(config, 'apiHost', {
  enumerable: true,
  get: () => apiHost.current().host,
});

/** `http://<api host>:<port>` for the current resolution, or `null`. */
config.apiBase = () => (config.apiHost ? `http://${config.apiHost}:${config.apiPort}` : null);

module.exports = config;
