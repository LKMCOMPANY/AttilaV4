# magicbox-proxy

Small Node reverse proxy that runs **on each VMOS box** (`marsbox`) and is the
single origin behind the box's Cloudflare Tunnel. It fronts the ArmCloud
backend (`cbs_go`, `:18182`) and the per-container scrcpy streams, and exposes:

| Route | Purpose |
|---|---|
| `GET /healthz` | Box health, container count, **resolved API host** (see below) |
| `WS  /stream/{db_id}/{video\|touch\|audio}` | Live device streams |
| `GET /stream-ready/{db_id}` | **Stream readiness probe** — real WebSocket handshake on the scrcpy port + in-guest agent; `{ ready, reason }` |
| `GET /proxy-test/{db_id}` | **Real proxy connectivity test** (see below) |
| `* ` (everything else) | Reverse-proxied to `cbs_go` (`/android_api/*`, `/container_api/*`, …) |

It listens on `127.0.0.1:8080`; `cloudflared` publishes it as
`https://box-N.attila.army` (protected by Cloudflare Access).

## Where `cbs_go` is (1.3.0)

`cbs_go` binds `:18182` on the box's **LAN address only** — never on
`127.0.0.1` — and the boxes are on DHCP. Until 1.2.0 that address was written
to `/etc/magicbox-proxy.env` by the deployer; when box-4's lease moved
(`.16` → `.237`, 25 September 2026) every request failed with `EHOSTUNREACH`
and the box read `offline` for four days.

Since 1.3.0 the address is **resolved** (`src/api-host.js`): the IPv4 of the
interface carrying the default route in `/proc/net/route` — which is what
`/v1/net_info` reports as `host_ip`, and the only one of the host's several
non-internal IPv4s (`docker0`, the `mac0` macvlan alias) that `cbs_go` uses.
It is re-resolved after any connect error a moved address would explain
(`EHOSTUNREACH`, `ECONNREFUSED`, `ENETUNREACH`, `ETIMEDOUT`) and every 15 s,
and every change is logged. The proxy never falls back to `127.0.0.1`: with no
default route it answers `503 api_unresolved` rather than hiding the fault.

`/healthz` says what it resolved — all fields additive over the 1.x shape:

```jsonc
{ "status": "ok", "version": "1.3.0", "uptime": 4091.1, "containers": 57,
  "api_host": "192.168.1.19", "api_iface": "eth0", "api_source": "default_route",
  "lan_ip": "192.168.1.19" }
// degraded: { "status": "degraded", …, "error": "api_unreachable" | "api_unresolved" }
```

`api_source` ∈ `default_route | iface | override | no_default_route`. The
reconcile worker persists `lan_ip` as the box's observed address.

## Tests

```bash
npm test          # node:test — unit tests + wire-contract tests against a fake box
```

`test/fixtures/{healthz,stream-ready}.json` are the wire contracts; the web
(`src/lib/streaming/stream-readiness.test.ts`) and the Mac client replay the
same files, so a payload change is a change on three sides.

## Why `/proxy-test` exists

The real proxy engine on a box is a **host-side `mihomo`** process per running
container, configured by `cbs_go` at
`state/{db_id}/mihomo.json` (holds `external-controller`, `secret`, and the
upstream proxy node).

The only reliable connectivity signal is mihomo's **delay test**, which routes
a request to a neutral 204 endpoint *through the upstream proxy*. But mihomo's
controller binds to `127.0.0.1` on the host, so it is **not reachable through
the tunnel**. `proxy-test.js` bridges that: it reads the per-container mihomo
config and calls the controller locally, returning a tunnel-safe result.

Note: `cbs_go`'s `proxy_get.healthy` flag is **not** a connectivity signal — it
reports `true` even for proxies that do not route. Do not use it for that.

### Contract

`GET /proxy-test/{db_id}` →

```jsonc
{ "ok": true,  "delayMs": 706 }                 // proxy reaches the internet
{ "ok": false, "error": "unreachable" }         // upstream blocked/down
{ "ok": false, "error": "proxy_not_provisioned" }   // 404 — no mihomo config
{ "ok": false, "error": "engine_unreachable" }      // 503 — container stopped
{ "ok": false, "error": "invalid_db_id" }           // 400
```

`db_id` is strictly validated (`^[A-Z0-9]+$`) before touching the filesystem.

## Configuration (env, all optional)

| Var | Default |
|---|---|
| `PROXY_PORT` | `8080` |
| `API_HOST` | *(unset — resolved from the default route; setting it is the box-4 footgun, leave it unset on the fleet)* |
| `API_IFACE` | *(unset — pin a named interface instead of the default route)* |
| `API_PORT` | `18182` |
| `API_HOST_REFRESH_MS` | `15000` |
| `STREAM_READY_TIMEOUT_MS` | `1500` |
| `CBS_STATE_DIR` | `/root/armcloud-container-backend-service/state` |
| `PROXY_TEST_URL` | `http://cp.cloudflare.com/generate_204` |
| `PROXY_TEST_TIMEOUT_MS` | `8000` |

## Deploy

Runs under systemd as `magicbox-proxy.service`. Deployment is handled by the
fleet deployer in [`../boxes`](../boxes), which ships this code **and** the box
config (cloudflared + units) in one idempotent pass:

```bash
cd ../boxes
BOX_SSH_PASSWORD=... ./scripts/deploy.sh --proxy-only 1 2 3 4   # just this code
BOX_SSH_PASSWORD=... ./scripts/deploy.sh 1 2 3 4                # full box converge
```

The deployer builds the `cloudflared access ssh` ProxyCommand itself from the
CF Access service token, so no hand-edited `~/.ssh/config` is required. See
[`../boxes/README.md`](../boxes/README.md).
