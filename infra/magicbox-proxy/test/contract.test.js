/**
 * Wire-contract tests: /healthz and /stream-ready against the JSON fixtures
 * that the web and Mac clients replay. A fake cbs_go (http) and a fake scrcpy
 * WebSocket server (tcp) stand in for the box, on ephemeral loopback ports.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');

const healthzFixture = require('./fixtures/healthz.json');
const streamReadyFixture = require('./fixtures/stream-ready.json');

// --- fake box -----------------------------------------------------------------

const state = {
  list: [],          // what list_names returns
  listOk: true,      // false → cbs_go down (connection refused)
  agentUp: false,    // v2 base/version_info answers code 200
};

function fakeCbs() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/container_api/v1/list_names') {
        return res.end(JSON.stringify({ code: 200, data: { host_ip: '127.0.0.1', list: state.list }, msg: 'success' }));
      }
      if (/\/android_api\/v2\/[A-Z0-9]+\/base\/version_info$/.test(req.url)) {
        return res.end(JSON.stringify(state.agentUp ? { code: 200, data: {} } : { code: 0, msg: 'not running' }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/** A TCP server that completes (or refuses) a WebSocket handshake. */
function fakeScrcpy(handshake) {
  return new Promise((resolve) => {
    const srv = net.createServer((socket) => {
      socket.once('data', () => {
        if (handshake) socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n');
        else socket.destroy();
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function request(server, url) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    http.get({ host: '127.0.0.1', port, path: url }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(body) }));
    }).on('error', reject);
  });
}

function sameKeys(actual, expected, label) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${label}: keys`);
}

// --- boot the proxy against the fake box --------------------------------------

let cbs;
let proxy;
let closedCbsPort;

test.before(async () => {
  cbs = await fakeCbs();
  process.env.API_HOST = '127.0.0.1';
  process.env.API_PORT = String(cbs.address().port);
  process.env.STREAM_READY_TIMEOUT_MS = '500';
  const config = require('../src/config');
  config.apiHostResolver.minRefreshIntervalMs = 0;
  const { handleHealth, isHealthCheck } = require('../src/health');
  const { handleStreamReady, isStreamReady } = require('../src/stream-ready');
  proxy = http.createServer((req, res) => {
    if (isHealthCheck(req.url)) return handleHealth(req, res);
    if (isStreamReady(req.url)) return handleStreamReady(req, res);
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
});

test.after(async () => {
  await new Promise((r) => proxy.close(r));
  await new Promise((r) => cbs.close(r));
});

// --- /healthz -------------------------------------------------------------------

test('/healthz ok: 1.x fields intact, 1.3.0 fields additive', async () => {
  state.list = [{ db_id: 'EDGEAAAAAAAAAAAA', state: 'stopped' }];
  const { status, json } = await request(proxy, '/healthz');
  assert.equal(status, healthzFixture.http_status.override);
  sameKeys(json, healthzFixture.variants.override, 'healthz ok');
  assert.equal(json.status, 'ok');
  assert.equal(json.containers, 1);
  assert.equal(json.api_host, '127.0.0.1');
  assert.equal(json.lan_ip, json.api_host);
  assert.equal(json.api_source, 'override');
  assert.equal(json.version, require('../package.json').version);
  // Legacy consumers only know these four; they must still be there.
  for (const k of Object.keys(healthzFixture.variants.legacy_1_2_0)) assert.ok(k in json, k);
});

test('/healthz degraded when cbs_go refuses: api_unreachable, 503', async () => {
  // Point the proxy at a port nobody listens on, then restore.
  const config = require('../src/config');
  const live = cbs.address().port;
  const dead = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  closedCbsPort = dead;
  config.apiPort = dead;
  await new Promise((r) => setTimeout(r, 3100)); // the 3 s container cache must expire first
  try {
    const { status, json } = await request(proxy, '/healthz');
    assert.equal(status, healthzFixture.http_status.api_unreachable);
    sameKeys(json, healthzFixture.variants.api_unreachable, 'healthz degraded');
    assert.equal(json.status, 'degraded');
    assert.equal(json.error, 'api_unreachable');
    assert.equal(json.api_host, '127.0.0.1');
  } finally {
    config.apiPort = live;
  }
});

test('api_source vocabulary is closed', () => {
  const { resolveApiHost } = require('../src/api-host');
  const seen = new Set([
    resolveApiHost({ override: '1.2.3.4' }).source,
    resolveApiHost({ iface: 'eth0', interfaces: { eth0: [{ address: '10.0.0.2', family: 'IPv4', internal: false }] } }).source,
    resolveApiHost({ routeTable: 'Iface\tDestination\n', interfaces: {} }).source,
    resolveApiHost({ routeTable: 'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\neth0\t00000000\t0100000A\t0003\t0\t0\t0\t00000000\t0\t0\t0\n', interfaces: { eth0: [{ address: '10.0.0.2', family: 'IPv4', internal: false }] } }).source,
  ]);
  assert.deepEqual([...seen].sort(), [...healthzFixture.api_source_values].sort());
});

// --- /stream-ready ------------------------------------------------------------

test('/stream-ready invalid db_id → 400 invalid_db_id', async () => {
  const { status, json } = await request(proxy, '/stream-ready/not-valid');
  assert.equal(status, streamReadyFixture.http_status.invalid_db_id);
  assert.deepEqual(json, streamReadyFixture.variants.invalid_db_id);
});

test('/stream-ready container absent → not_listed', async () => {
  state.list = [];
  await new Promise((r) => setTimeout(r, 3100)); // let the container cache expire
  const { status, json } = await request(proxy, '/stream-ready/EDGEZZZZZZZZZZZZ');
  assert.equal(status, 200);
  assert.deepEqual(json, streamReadyFixture.variants.not_listed);
});

test('/stream-ready ready / projection_dead / android_down', async () => {
  const alive = await fakeScrcpy(true);
  const dead = await fakeScrcpy(false);
  try {
    state.list = [
      { db_id: 'EDGEALIVE0000000', state: 'running', tcp_port: alive.address().port },
      { db_id: 'EDGEDEAD00000000', state: 'running', tcp_port: dead.address().port },
    ];
    await new Promise((r) => setTimeout(r, 3100));

    let res = await request(proxy, '/stream-ready/EDGEALIVE0000000');
    assert.deepEqual(res.json, streamReadyFixture.variants.ready);

    state.agentUp = true;
    res = await request(proxy, '/stream-ready/EDGEDEAD00000000');
    assert.deepEqual(res.json, streamReadyFixture.variants.projection_dead);

    state.agentUp = false;
    res = await request(proxy, '/stream-ready/EDGEDEAD00000000');
    assert.deepEqual(res.json, streamReadyFixture.variants.android_down);
  } finally {
    alive.close();
    dead.close();
  }
});

test('/stream-ready when cbs_go is down → resolve_failed', async () => {
  const config = require('../src/config');
  const live = cbs.address().port;
  config.apiPort = closedCbsPort;
  state.list = [];
  await new Promise((r) => setTimeout(r, 3100));
  try {
    const { status, json } = await request(proxy, '/stream-ready/EDGEALIVE0000000');
    assert.equal(status, 200);
    assert.deepEqual(json, streamReadyFixture.variants.resolve_failed);
  } finally {
    config.apiPort = live;
  }
});

test('the terminal reason set is exactly what the clients hard-code', () => {
  assert.deepEqual(streamReadyFixture.terminal_reasons, ['projection_dead']);
  const reasons = Object.values(streamReadyFixture.variants).map((v) => v.reason).filter(Boolean);
  assert.deepEqual(reasons.sort(), ['android_down', 'invalid_db_id', 'not_listed', 'projection_dead', 'ready', 'resolve_failed']);
});
