# Proxy strategy

How proxies are assigned, tested, and self-served across the fleet, and the
recommended VMOS proxy settings for anti-detection during social account
creation and operation.

## Lifecycle (two phases)

1. **Creation (us, manual/tooled — `MagicBox-Industrial`)**
   - When a box is provisioned, each device gets a SOCKS5 proxy set as the LAST
     step of the 19-step sequence (proxy after `replace_devinfo`, which can reset
     it — see `ADB-REFERENCE.md` §9).
   - We use **Oxylabs** (`disp.oxylabs.io:<sticky-port>:<user>:<pass>`), and the
     IP is checked BEFORE hand-off with the device-shell `checkProxyIp` (one
     `curl` through the proxy to `ip-api.com` — the only approved geo endpoint,
     stateless/cookieless) to confirm it isn't blacklisted and geolocates where
     expected. This is what keeps social signups from being blocked.
   - Format everywhere: `ip:port:username:password` (SOCKS5).

2. **Delivery (client, self-serve — Attila operator dashboard)**
   - Once a box is linked to a client account, the client manages proxies from
     the operator **Device tab → Proxy** section with ANY provider they choose:
     - **Paste** `host:port:user:pass` (or `socks5://user:pass@host:port`,
       `user:pass@host:port`) → fields auto-fill (`parseProxyString`).
     - **Save** → `proxy_set` on the device (live, hot-reload) + persisted.
     - **Verify** → real routing test via `/proxy-test` (mihomo delay through the
       upstream), not just a config read-back.
     - **Disable** → `proxy_stop` clears the proxy (direct connection).
   - The device must be **running** to change its proxy (VMOS applies it to the
     live mihomo engine). Passwords are never sent back to the browser; leaving
     the password blank on edit keeps the stored one.

The goal: ship boxes with devices already proxied + checked, and let clients
swap providers themselves without us in the loop.

## Recommended VMOS proxy settings (`proxy_set`)

`setProxyConfig` (`src/lib/box-api.ts`) posts to
`/android_api/v1/proxy_set/{db_id}`. Current + recommended values:

- **Protocol**: `socks5` (recommended default over HTTP — carries auth + UDP,
  and is what our providers hand out). HTTP is available for providers that only
  offer it.
- **DNS over proxy** (`dnsOverProxyDisabled: false`): KEEP. Resolving DNS through
  the proxy exit is the anti-leak default — the device must not resolve names via
  a resolver reachable on the real uplink, or the real location leaks. This is
  correct today.
- **DNS servers** (`8.8.8.8`, `8.8.4.4`): acceptable because they're resolved
  *through* the proxy. If a provider offers geo-matched resolvers, prefer them.
- **UDP** (`udpDisabled: false` today): RECOMMEND flipping to **`true`** for the
  account-creation profile. Residential SOCKS5 endpoints frequently don't carry
  UDP; with UDP enabled, QUIC/WebRTC can fall back to the direct uplink and leak
  the real IP. Disabling UDP forces TCP and closes that leak. Trade-off: some
  video paths prefer QUIC — validate on box-5 before flipping fleet-wide.
- **Mode (`proxy` iptables vs `vpn`)**: the Edge `proxy_set` endpoint does NOT
  take a mode parameter — mode is a **create-time** decision written to the
  Android prop `ro.sys.cloud.proxy.mode` (`proxy` = iptables, `vpn` = Android VPN
  service with DNS-leak protection). For social account creation, **`vpn` mode is
  the safer default** (system-level capture + DNS-leak protection). Set it in the
  provisioning `create`/prop step (`MagicBox-Industrial`), not from the operator
  UI. Audit which mode existing devices use and standardize new devices to `vpn`.

## Auditing what is actually happening

```bash
node scripts/audit-proxies.mjs --running-only --geo
```

`/proxy-test/{db_id}` is the real routing verdict — a mihomo delay measurement
through the upstream. The `healthy` flag on `proxy_get` only reflects what was
configured, so it will happily call a dead upstream healthy. mihomo runs inside
the container, so a stopped device reports `engine_unreachable`; that is
expected, not a dead proxy.

`--geo` additionally checks that the exit IP lands where the avatar claims to
live. A French persona egressing from a German IP is a detection risk no
latency probe can see.

> **Do not use `/android_api/v1/ip_geo/{db_id}` for this.** Despite the name it
> geolocates the *configured proxy hostname*, not the session's egress:
> `disp.oxylabs.io` resolves to the Oxylabs dispatcher in Falkenstein, so every
> Oxylabs device reads as German regardless of the port's actual exit. Only a
> request made from **inside the guest** traverses the proxy. Measured on a FR
> device: `ip_geo` said Falkenstein/Germany, while asking the device itself
> returned 82.26.244.28, Paris, Orange — matching its `Europe/Paris` timezone
> and `fr` SIM.

Two upstream providers are live today, contrary to what this document used to
imply: **Oxylabs** (`disp.oxylabs.io`, sticky port per device) on the European
devices, and **NodeMaven** (`gate.nodemaven.com:1080`) on the US ones.

## What is implemented vs recommended

- Implemented: paste parsing, live `proxy_set`/`proxy_stop`, real `/proxy-test`
  verify, password redaction + blank-keeps-current, client `UPDATE` RLS policy so
  saves persist. `dnsOverProxyDisabled:false` (correct).
- Recommended follow-ups (validate on box-5, then roll forward — gated):
  - Flip `udpDisabled` → `true` for the account-creation profile.
  - Standardize new devices to proxy **mode `vpn`** at creation.
  - Keep the creation-time Oxylabs IP/blacklist check (`checkProxyIp`) as the
    gate before hand-off.
