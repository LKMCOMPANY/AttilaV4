# magicbox-proxy

Small Node reverse proxy that runs **on each VMOS box** (`marsbox`) and is the
single origin behind the box's Cloudflare Tunnel. It fronts the ArmCloud
backend (`cbs_go`, `:18182`) and the per-container scrcpy streams, and exposes:

| Route | Purpose |
|---|---|
| `GET /healthz` | Box health + running container count |
| `WS  /stream/{db_id}/{video\|touch\|audio}` | Live device streams |
| `GET /stream-ready/{db_id}` | **Stream readiness probe** — TCP-connects the scrcpy video port; `{ ready: boolean }` |
| `GET /proxy-test/{db_id}` | **Real proxy connectivity test** (see below) |
| `* ` (everything else) | Reverse-proxied to `cbs_go` (`/android_api/*`, `/container_api/*`, …) |

It listens on `127.0.0.1:8080`; `cloudflared` publishes it as
`https://box-N.attila.army` (protected by Cloudflare Access).

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
| `API_HOST` / `API_PORT` | box LAN IP / `18182` |
| `CBS_STATE_DIR` | `/root/armcloud-container-backend-service/state` |
| `PROXY_TEST_URL` | `http://cp.cloudflare.com/generate_204` |
| `PROXY_TEST_TIMEOUT_MS` | `8000` |

## Deploy

Runs under systemd as `magicbox-proxy.service`. To roll out a change:

```bash
./scripts/deploy.sh ssh-box-1.attila.army ssh-box-2.attila.army \
                    ssh-box-3.attila.army ssh-box-4.attila.army
```

This syncs `src/` + `package.json`, runs `npm install --omit=dev`, restarts the
service, and checks `/healthz`. SSH access is expected via a `~/.ssh/config`
`Host ssh-box-*.attila.army` block using a `cloudflared access ssh`
ProxyCommand.
