/**
 * Wire-contract tests: /proxy-test in guest mode (no host-side mihomo.json)
 * against `fixtures/proxy-test.json`. A fake cbs_go answers the guest shell,
 * a fake "ipinfo" answers the box's WAN lookup — all on loopback.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fixture = require('./fixtures/proxy-test.json');

const state = {
  shellOk: true,          // cbs_go shell answers code 200
  guestBody: '',          // what `curl ipinfo.io/json` prints in the guest
  engineState: '0\n0',    // `ps | grep -c clash; ip rule | grep -c Meta` in the guest
  wanIp: '145.224.95.86', // what the host sees as its own address
};

function fakeCbsAndWan() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/wan') return res.end(state.wanIp);
      if (/^\/android_api\/v1\/shell\/[A-Z0-9]+$/.test(req.url) && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          if (!state.shellOk) return res.end(JSON.stringify({ code: 201, msg: 'instance not running' }));
          const { cmd } = JSON.parse(body);
          if (/^ps -A/.test(cmd)) return res.end(JSON.stringify({ code: 200, data: { message: state.engineState } }));
          assert.match(cmd, /^curl -s -m \d+ /);
          res.end(JSON.stringify({ code: 200, data: { message: state.guestBody } }));
        });
        return;
      }
      res.statusCode = 404;
      res.end('{}');
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

let cbs;
let proxy;
let guestProbe;

test.before(async () => {
  cbs = await fakeCbsAndWan();
  const port = cbs.address().port;
  process.env.API_HOST = '127.0.0.1';
  process.env.API_PORT = String(port);
  process.env.CBS_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cbs-state-')); // empty: no mihomo.json
  process.env.WAN_IP_URL = `http://127.0.0.1:${port}/wan`;
  process.env.GUEST_EXIT_URL = 'http://ipinfo.test/json';
  process.env.PROXY_TEST_TIMEOUT_MS = '2000';
  const config = require('../src/config');
  config.apiHostResolver.minRefreshIntervalMs = 0;
  guestProbe = require('../src/guest-probe');
  const { handleProxyTest, isProxyTest } = require('../src/proxy-test');
  proxy = http.createServer((req, res) => {
    if (isProxyTest(req.url)) return handleProxyTest(req, res);
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
});

test.after(async () => {
  await new Promise((r) => proxy.close(r));
  await new Promise((r) => cbs.close(r));
});

test('guest engine routing: the exit differs from the box WAN address', async () => {
  guestProbe.resetWanCache();
  state.shellOk = true;
  state.engineState = '1\n1';
  state.guestBody = JSON.stringify({ ip: '151.241.63.63', country: 'GB', city: 'London' });
  const { status, json } = await request(proxy, '/proxy-test/EDGE7BM34VZ2S3J9');
  assert.equal(status, fixture.http_status.guest_routes);
  sameKeys(json, fixture.variants.guest_routes, 'guest_routes');
  assert.equal(json.ok, true);
  assert.equal(json.engine, 'guest');
  assert.deepEqual(json.exit, fixture.variants.guest_routes.exit);
  assert.equal(typeof json.delayMs, 'number');
});

test('an in-guest engine whose TUN is not routing yet is engine_starting, not unproxied', async () => {
  state.engineState = '1\n0';
  state.guestBody = JSON.stringify({ ip: state.wanIp, country: 'FR', city: 'Paris' });
  const { status, json } = await request(proxy, '/proxy-test/EDGEFONGIQ9LK3SS');
  assert.equal(status, fixture.http_status.guest_engine_starting);
  sameKeys(json, fixture.variants.guest_engine_starting, 'guest_engine_starting');
  assert.equal(json.error, 'engine_starting');
});

test('guest exits through the box WAN address → unproxied, never ok', async () => {
  guestProbe.resetWanCache();
  state.engineState = '0\n0';
  state.guestBody = JSON.stringify({ ip: state.wanIp, country: 'FR', city: 'Paris' });
  const { status, json } = await request(proxy, '/proxy-test/EDGE7BM34VZ2S3J9');
  assert.equal(status, fixture.http_status.guest_unproxied);
  sameKeys(json, fixture.variants.guest_unproxied, 'guest_unproxied');
  assert.equal(json.error, 'unproxied');
  assert.equal(json.exit.ip, state.wanIp);
});

test('a guest that cannot reach the internet is unreachable, not unproxied', async () => {
  state.guestBody = '';
  const { status, json } = await request(proxy, '/proxy-test/EDGE7BM34VZ2S3J9');
  assert.equal(status, fixture.http_status.guest_unreachable);
  sameKeys(json, fixture.variants.guest_unreachable, 'guest_unreachable');
  assert.equal(json.error, 'unreachable');
});

test('a stopped container is engine_unreachable (503)', async () => {
  state.shellOk = false;
  const { status, json } = await request(proxy, '/proxy-test/EDGE7BM34VZ2S3J9');
  assert.equal(status, fixture.http_status.engine_unreachable);
  sameKeys(json, fixture.variants.engine_unreachable, 'engine_unreachable');
  state.shellOk = true;
});

test('an invalid db_id is rejected before anything is asked', async () => {
  const { status, json } = await request(proxy, '/proxy-test/not-a-db-id');
  assert.equal(status, fixture.http_status.invalid_db_id);
  sameKeys(json, fixture.variants.invalid_db_id, 'invalid_db_id');
});

test('the fixture keeps the 1.3.0 shape decodable', () => {
  const legacy = fixture.variants.legacy_1_3_0;
  assert.deepEqual(Object.keys(legacy).sort(), ['delayMs', 'ok']);
  for (const [name, variant] of Object.entries(fixture.variants)) {
    assert.equal(typeof variant.ok, 'boolean', name);
    assert.ok(fixture.http_status[name], `${name} has an http status`);
  }
});
