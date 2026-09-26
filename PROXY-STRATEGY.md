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

Two upstream providers are live today. The split is **per box**, not per
region (DB `devices.proxy_host`, 9 September 2026):

| Box | NodeMaven `gate.nodemaven.com` | Oxylabs `disp.oxylabs.io` | none recorded |
|---|---:|---:|---:|
| box-1 | 82 | 10 | 4 |
| box-2 | 55 | 1 | 1 |
| box-3 | 0 | 14 | **112** |
| box-4 | 65 | 1 | 7 |
| box-5 | 0 | 100 | 0 |

NodeMaven accounts encode the exit in the username
(`…-country-us-region-massachusetts-type-mobile-…-sid-US13-ttl-24h-…`): on
box-2 and box-4 every device probed on 9 September had a `mobile` proxy whose
country matched the device locale, and its measured exit IP matched too
(`ip-api` from inside the guest). On **box-3** the DB has no proxy recorded for
112 of 126 devices (columns never synced — `proxy_get` needs a running
container), and the live probes were incoherent: 3 of 6 FR devices egressed
through US IPs (Sacramento, Newark), and the **same** FR device egressed from
Bastia on one boot and London on the next. Whatever box-3 runs is not pinned
to the persona's country. Audit it with the devices running, then fix it,
before any maintenance session touches those accounts.

Persona ↔ device mismatches are a separate problem the proxy cannot fix: the
three Emirati avatars probed on box-4 live on US devices (New York timezone,
Connecticut/Massachusetts exits). The coherence check to automate is
`avatars.country_code` ↔ device timezone/locale ↔ exit-IP country ↔ language
of the notifications the apps receive, at every session, with an attention
item when it fails.

## Measured on the whole fleet — 26 September 2026 (one boot per device)

`scripts/audit-device-health.mjs --with-proxy` booted every device of the four
online boxes (two starts in flight per box, LAN-first) and, on the same boot,
read the configured proxy, tested routing (`/proxy-test`, magicbox-proxy
1.3.2) and asked the guest where it comes out (`ipinfo.io` from inside).

| Box | booted | configured | routes | exit ≠ persona | not routing | no proxy |
|---|---:|---:|---:|---:|---:|---:|
| box-1 | 95 (6 dead) | 89 | 86 | **0** / 80 checked | 3 (`DOWN`, NodeMaven) | 1 (US42, dead) |
| box-2 | 57 | 56 | 53 | 1 / 51 (spare, Oxylabs) | 3 (`DOWN`, NodeMaven) | 1 |
| box-3 | 126 | 108–112 | 103 | **85** / 104 checked | 1 (`UNPROXIED`, US32) | 14–18 |
| box-4 | 73 | 72 | 72 | 1 / 71 (`GB41`, row says CN) | 0 | 1 |

Three facts, none visible before:

1. **The proxy engine runs in two places, and the old probe knew one.** In the
   default mode cbs_go runs a host-side `mihomo` per container
   (`state/<db_id>/mihomo.json`) — every NodeMaven device, and the `US1xx`
   Oxylabs range of box-3. In the **"vpn" mode** the engine is a `clash`
   process *inside the guest* on a `Meta` TUN (198.18.0.1/30, policy
   routing) — 60 of box-3's 126 containers. magicbox-proxy ≤ 1.3.0 answered
   `proxy_not_provisioned` for those; 1.3.1+ asks the guest and compares its
   exit with the box's own WAN address (`engine: guest`, `unproxied`).
2. **The vpn mode leaks the box's address for 15–20 s after every boot.**
   Measured on CA2 (box-3): at `sys.boot_completed` the clash process exists
   but its TUN has no address and no rule, and the guest egresses through
   `145.224.95.86` (the box); at +20 s the TUN is up and the exit is the
   proxy's (`82.26.244.28`). A host-side engine (US23, box-2) routes from
   +0 s. Whatever the apps do in those first seconds (push registration,
   telemetry, the feed's first fetch) leaves with the operator's residential
   IP. **Recommendation reversed:** do not standardise on `vpn`; the host-side
   mode is the one with no window. The 1.3.2 probe answers `engine_starting`
   during the window and the sweep polls through it (45 s budget) before
   calling anything `unproxied`.
3. **box-3's Oxylabs exits are not the personas' countries.** 85 of 104
   checked devices exit elsewhere: `CA` → Paris, `DE` → London, `FR` → New
   York / Leesburg / London, `US` → Paris / London; only the `GB` devices and
   the `US117`–`US144` range (ports 8271–8298) come out where they claim. The
   sticky port does not carry the country — the Oxylabs username does, and
   these were provisioned without it (or with the wrong one). One
   re-assignment pass on box-3 (correct `cc-XX` usernames, host-side mode)
   fixes 85 devices; until then those accounts must not be maintained or
   automated. One box-scoped `proxy_incoherent` attention item carries the
   list (`scripts/record-sweep-attention.ts`).

Also measured: `proxy_get` right after boot intermittently reports a proxy
`disabled` that the previous or next boot reports enabled (4 different devices
each run on box-3) — read it a few seconds after `boot_completed`, never as
the only source. The six NodeMaven `DOWN` devices (DE2, GB3, GB8 on box-1;
GB34, GB35, US13 on box-2) had a host-side engine that did not answer while
the container ran — re-test before touching the upstream.

## The method — one provider, one profile, one proxy per device (decided 26 September 2026)

Two providers meant two engines, two username grammars and two failure
modes; the measurements above are the bill. From here on:

1. **One provider (Oxylabs), dedicated per device.** Static residential / ISP
   IPs, one per device, never shared, bought in the persona's country and —
   for the accounts that already live somewhere — in the city their current
   exit uses (a platform sees an IP move; a move within the same city is a
   trip, a move across the Atlantic is a new person). The list is supplied by
   the operator as a CSV: `country,host,port,username,password[,city]`.
2. **One profile, written by one function** — `proxySetPayload()` in
   `src/lib/box-api/proxy.ts`, used by the operator route and by the fleet
   migration alike: `engineType 1` (host-side mihomo — routes from the first
   second, no boot window), `udpDisabled true` (residential SOCKS5 carries no
   UDP; QUIC / WebRTC must not fall back to the raw uplink),
   `dnsOverProxyDisabled false` + Google resolvers (names resolve through the
   exit). SOCKS5 with authentication.
3. **Every device gets one**, avatar or not: a device that boots without a
   proxy — for a probe, an install, a sweep — leaves with the office's IP.
   Spare ~10 % per country for replacements.
4. **Proof on the same boot.** `scripts/assign-proxies.ts` boots each device
   (two per box), writes the proxy, re-reads it, runs `/proxy-test` and asks
   the guest where it comes out, mirrors `devices.proxy_*`, stops what it
   started, and reports `OK` / `MISMATCH` / not routing per device. The plan
   (`--dry-run`) is deterministic: same list, same devices, same pairs.
5. **NodeMaven is retired when the last device has moved** — verified by
   `select count(*) from devices where proxy_host like '%nodemaven%'` = 0 and
   a full `audit-device-health --with-proxy` pass with 0 mismatches.
6. **A proxy written on a running device is applied by a restart.** `proxy_set`
   reloads the host engine and the controller's delay test passes at once, but
   the guest has no egress until its next boot (US23, 26 September 2026:
   `curl ipinfo.io` answered before the write, nothing for 160 s after it,
   the proxy's exit again on the next start). The operator core restarts the
   container after a successful write and says so (`restarted: true`; web
   toast, Mac notice, MCP summary); the migration stops what it started, so
   the next start applies it. Never judge a proxy from the delay test alone.

### Three ways in, one engine

| Way | Surface | Path |
|---|---|---|
| Fleet, from Cursor | `scripts/assign-proxies.ts --csv` / `--reapply` | LAN boot → `setProxyConfig` (tunnel) → proof → DB mirror → stop |
| Advanced user, from Cursor | Attila.app MCP `device_proxy set / verify` | `nativeRoute` `/api/devices/{id}/proxy/set` → `updateDeviceProxyCore` |
| Operator, web or Mac | avatar › Device › Proxy | the same route, the same core |

All three end in `setProxyConfig` → `proxySetPayload()`; the engine switch
(`proxy_stop` when the device runs the in-guest engine) and the restart live
below the route, so no client can write a proxy any other way.

### Migration log

- **26 September 2026, list of 100 dedicated ports (`8001–8100`, GB 60 /
  FR 30 / US 10, account already in the fleet).** 47 devices moved, each
  proven on the same boot and again by an independent sweep after it: box-3's
  26 FR (exits FR/Paris) and 3 GB (GB/London), the 10 US the list allowed
  (New York City, Leesburg — US13, US25, US32, US56, US100, US26–30), box-1/2's
  NodeMaven engines that were `DOWN` (GB3, GB8, GB34, GB35), the spare
  GB41_box2_spare. Sweep after: 44/44 routing, 43 exits read, **0
  mismatch, 0 unproxied**. The list's port `8011` is labelled GB and exits GB
  (`151.241.182.75`); the one FR reading on it was the reload window.
  **Attention: box-5's 100 devices (offline since 21 September) are recorded
  on these same ports `8001–8100` with the short account spelling** — they
  must be re-assigned before box-5 is ever started again, or two devices will
  share one dedicated IP.
- Still to move (the list had no ports for them): **42 US, 15 ES, 9 DE,
  4 CA on box-3** (wrong-country Oxylabs exits) and **211 NodeMaven devices**
  (box-1 82, box-2 55, box-4 65 — working, to unify on Oxylabs when the ports
  exist; meanwhile `--reapply --provider nodemaven` puts them on the one
  profile without changing their IP).

What to order (devices on the four online boxes, 26 September 2026, +10 %):

| Country | devices | to order | cities the accounts already exit from |
|---|---:|---:|---|
| US | 159 | **175** | Boston 50, Avon 18, Westborough 11, Cambridge 8, Windsor 6, New York 5 (Massachusetts for most) |
| FR | 61 | **67** | Paris 24, Vouillé 4 |
| GB | 52 | **57** | London 28, Manchester 9 |
| ES | 51 | **56** | Madrid 23, Albacete 8 |
| DE | 20 | **22** | Frankfurt 3, Hamburg 2, Essen, Mainz, Nuremberg, Hannover |
| CA | 5 | **6** | — |
| **total** | **348** | **383** | |

Four device rows must be fixed before the run, not bought for: `GB41`
(box-4, `country` column says `CN`, persona is GB), `parked_probe_box2_b`
(`CN`), and two box-3 rows without a readable country. box-5 (100 devices,
offline, Oxylabs already) joins when it is reachable again.

## What is implemented vs recommended

- Implemented: paste parsing, live `proxy_set`/`proxy_stop`, real `/proxy-test`
  verify, password redaction + blank-keeps-current, client `UPDATE` RLS policy so
  saves persist. `dnsOverProxyDisabled:false` (correct). Since 26 September
  2026 the payload is `proxySetPayload()` — `engineType 1`, `udpDisabled true`.
- Recommended follow-ups (validate on box-5, then roll forward — gated):
  - ~~Flip `udpDisabled` → `true` for the account-creation profile.~~ Done in
    the one profile; the creation flow in `MagicBox-Industrial` should send the
    same body.
  - ~~Standardize new devices to proxy **mode `vpn`** at creation.~~ Reversed
    26 September 2026 — the in-guest engine leaks the box's address for
    15–20 s after every boot (measured above); keep the host-side mode.
  - Keep the creation-time Oxylabs IP/blacklist check (`checkProxyIp`) as the
    gate before hand-off.
