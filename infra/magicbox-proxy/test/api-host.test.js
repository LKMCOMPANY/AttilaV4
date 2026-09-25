const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ApiHostResolver,
  addressOf,
  defaultRouteInterface,
  resolveApiHost,
  shouldRefreshOn,
} = require('../src/api-host');

// A real L1 host on 25 September 2026 (box-4): eth0 carries the default route,
// docker0 and the `mac0` macvlan alias carry other non-internal IPv4s — the
// exact layout that made "first non-internal IPv4" unsafe.
const ROUTE_TABLE = [
  'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT',
  'eth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0',
  'eth0\t0001A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0',
  'docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0',
  'mac0\tFC01A8C0\t00000000\t0005\t0\t0\t0\tFFFFFFFF\t0\t0\t0',
  '',
].join('\n');

const INTERFACES = {
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
  mac0: [{ address: '192.168.1.252', family: 'IPv4', internal: false }],
  eth0: [
    { address: 'fe80::1', family: 'IPv6', internal: false },
    { address: '192.168.1.237', family: 'IPv4', internal: false },
  ],
};

test('default route interface is read from /proc/net/route', () => {
  assert.equal(defaultRouteInterface(ROUTE_TABLE), 'eth0');
});

test('no default route → null, never a guess', () => {
  const noDefault = ROUTE_TABLE.split('\n').filter((l) => !l.startsWith('eth0\t00000000')).join('\n');
  assert.equal(defaultRouteInterface(noDefault), null);
  assert.equal(defaultRouteInterface(''), null);
});

test('two default routes: the lowest metric wins', () => {
  const two = ROUTE_TABLE + 'wlan0\t00000000\t0101A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0\n';
  assert.equal(defaultRouteInterface(two), 'eth0');
  const flipped = two.replace('eth0\t00000000\t0101A8C0\t0003\t0\t0\t100', 'eth0\t00000000\t0101A8C0\t0003\t0\t0\t700');
  assert.equal(defaultRouteInterface(flipped), 'wlan0');
});

test('a default route that is not UP is ignored', () => {
  const down = ROUTE_TABLE.replace('eth0\t00000000\t0101A8C0\t0003', 'eth0\t00000000\t0101A8C0\t0002');
  assert.equal(defaultRouteInterface(down), null);
});

test('addressOf picks the IPv4 of the named interface, skipping IPv6', () => {
  assert.equal(addressOf('eth0', INTERFACES), '192.168.1.237');
  assert.equal(addressOf('mac0', INTERFACES), '192.168.1.252');
  assert.equal(addressOf('wlan0', INTERFACES), null);
});

test('resolveApiHost follows the default route, not the first interface', () => {
  const r = resolveApiHost({ routeTable: ROUTE_TABLE, interfaces: INTERFACES });
  assert.deepEqual(r, { host: '192.168.1.237', iface: 'eth0', source: 'default_route' });
});

test('resolveApiHost honours API_HOST as an explicit override and says so', () => {
  const r = resolveApiHost({ override: '192.168.1.16', routeTable: ROUTE_TABLE, interfaces: INTERFACES });
  assert.deepEqual(r, { host: '192.168.1.16', iface: null, source: 'override' });
});

test('resolveApiHost honours API_IFACE', () => {
  const r = resolveApiHost({ iface: 'mac0', routeTable: ROUTE_TABLE, interfaces: INTERFACES });
  assert.deepEqual(r, { host: '192.168.1.252', iface: 'mac0', source: 'iface' });
});

test('resolveApiHost never falls back to 127.0.0.1', () => {
  const r = resolveApiHost({ routeTable: '', interfaces: INTERFACES });
  assert.deepEqual(r, { host: null, iface: null, source: 'no_default_route' });
});

test('only connect errors a moved address would explain trigger a refresh', () => {
  for (const code of ['EHOSTUNREACH', 'ECONNREFUSED', 'ENETUNREACH', 'ETIMEDOUT']) {
    assert.equal(shouldRefreshOn({ code }), true, code);
  }
  assert.equal(shouldRefreshOn({ code: 'ECONNRESET' }), false);
  assert.equal(shouldRefreshOn(new Error('API timeout')), false);
  assert.equal(shouldRefreshOn(null), false);
});

test('ApiHostResolver emits change when the address moves (the box-4 case)', () => {
  const state = { interfaces: INTERFACES };
  const resolver = new ApiHostResolver({
    minRefreshIntervalMs: 0,
    routeTable: ROUTE_TABLE,
    get interfaces() { return state.interfaces; },
  });
  assert.equal(resolver.current().host, '192.168.1.237');

  const changes = [];
  resolver.on('change', (c) => changes.push(c));

  // DHCP lease moves: .237 → .16 on the same interface.
  state.interfaces = { ...INTERFACES, eth0: [{ address: '192.168.1.16', family: 'IPv4', internal: false }] };
  assert.equal(resolver.refreshOnError({ code: 'EHOSTUNREACH' }), true);
  assert.equal(resolver.current().host, '192.168.1.16');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].previous.host, '192.168.1.237');
  assert.equal(changes[0].current.host, '192.168.1.16');
  assert.equal(changes[0].reason, 'EHOSTUNREACH');

  // Same address again: no event.
  resolver.refresh('timer');
  assert.equal(changes.length, 1);

  // An unrelated error does not refresh.
  assert.equal(resolver.refreshOnError({ code: 'ECONNRESET' }), false);
});

test('ApiHostResolver rate-limits refreshes', () => {
  const resolver = new ApiHostResolver({ minRefreshIntervalMs: 60_000, routeTable: ROUTE_TABLE, interfaces: INTERFACES });
  resolver.refresh('a');
  const before = resolver.lastRefreshAt;
  resolver.refresh('b');
  assert.equal(resolver.lastRefreshAt, before);
});
