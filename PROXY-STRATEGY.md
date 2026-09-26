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
   calling anything `unproxied`. Re-measured on FR18 (box-1, host engine)
   after one `UNPROXIED` reading during box-1's tunnel incident: exit polled
   every 2 s from `run` — the proxy's address from the first answer the shell
   gave (+22 s, *before* `sys.boot_completed`), 22 readings, 0 through the
   box. What cbs_go writes for that engine (`state/<db_id>/mihomo.json`,
   read on box-1): one `socks5` node, a `select` group `[node, DIRECT]`,
   rules `DOMAIN,<gateway>,DIRECT` · `NETWORK,udp,REJECT` · `MATCH,PROXY`,
   `mode rule`. `select` does not fail over by itself, so a dead upstream
   fails closed; `DIRECT` is only ever chosen by the controller. Two facts
   to raise with VMOS: the `dnsServers` we send are not what mihomo resolves
   with — the file carries the vendor's list (`223.5.5.5`, `1.1.1.1`,
   `8.8.8.8`, DoH Google and Cloudflare, `fake-ip`), so a Chinese resolver
   is in the race for every name the guest looks up; and `DIRECT` has no
   business in a group whose only job is to hide the box.
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
   **One holder per proxy across the whole fleet**, offline boxes included:
   the planner reserves every `host:port` the DB mirror shows held, whatever
   the box's status, and hands out only free ones; a device keeps its own at
   its turn whatever the sort order. `--reclaim-offline` is the one explicit
   way to re-purpose a list recorded on an offline box, and the run says how
   many it reclaimed. A device the sweep recorded `dead` is never booted for
   a proxy (it sits in `starting` for hours and leaks nothing).
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
   (`--dry-run`) is deterministic — same list, same devices, same pairs — and
   reads as `= keeps` (holds it already, not touched) or `←` (to write).
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
- **26 September 2026, afternoon — the 211 NodeMaven devices re-written on
  the one profile** (`--reapply --provider nodemaven`, same upstream, same
  IP): 210 proven `OK` (exit in the persona's country), 1 `MISMATCH` (`GB41`,
  exits GB/Birkenhead, row says CN). It took three passes, none for the
  method: box-1's Cloudflare tunnel dropped for a few minutes at 14:52
  (`cloudflared` "context canceled"; the journal on the box only starts at
  14:45, cbs_go never restarted) and every write and `/proxy-test` riding it
  failed — 23 `fetch failed`, 4 `DOWN`, 1 `FAIL`, 1 `UNPROXIED` (FR18), 3
  `boot_timeout`; the 32 re-run once the tunnel was back: 32 `OK`. Three
  devices busy with a maintenance task at plan time (ES2, FR19, GB4) and FR5
  (twice past 120 s under the run's own load, 15 s alone): 4 `OK`. FR18's
  one `UNPROXIED` reading is not reproduced (measured above) and is filed
  under the tunnel incident, not under the engine.
- **Same day — 46 NodeMaven GB / FR devices moved onto the list's ports
  (`--csv --reclaim-offline`)**: 45 GB incl. the two parked probes
  (`parked_probe_box2_b`, `parked_probe_box3_jun22`, now `GB`; box-1 14,
  box-2 22, box-3 6, box-4 3) → GB/London, 3 FR (FR1, FR11, FR12) →
  FR/Paris — 48 proven on the same boot, GB48 routes with its exit unread.
  FR10 (box-1)
  timed out twice and is `dead` since 25 September: it holds GB port `8049`
  on-box and keeps it; the FR port it was planned for went to FR12. The
  dry-run of this pass caught a planner defect before any write: a port held
  by a device sorted *after* the taker was handed out (`FR1 ← 8001`, held by
  `parked_box3_8001`) — fixed and tested, reservations are now fleet-wide,
  offline boxes included, and `--reclaim-offline` names what it takes back
  (100 ports recorded on box-5).
- **Where the fleet stands (352 devices on the four online boxes):** 170 on
  the list / Oxylabs dedicated, **170 still on NodeMaven** (US 94, ES 35,
  FR 27, DE 12, CA 1, GB41) — all on the one profile, all proven — and 12
  without a proxy: the 4 dead of box-1 (FR4, US2, US42, US8) and 8
  avatar-less, app-less spares on box-3 (CA1, ES23, ES24, ES33, US109,
  US128, US139, US144) that wait for ports in their country. box-3's
  wrong-country Oxylabs exits: **61** left (US 38, ES 12, DE 8, CA 3), the
  box-scoped `proxy_incoherent` item still lists the 85 of the first sweep
  until the next full pass of box-3 refreshes it. NodeMaven is retired when
  those 170 have moved; nothing else depends on it.

- **26 September 2026, evening — the second hundred (`8101–8200`: FR 30,
  GB 70, same account, three ports proven from the operator's Mac before any
  device saw them: FR/Paris, FR/Paris, GB/London).** No US, ES, DE or CA in
  it, so it went where it is coherent and nowhere else: **15 FR devices with
  live accounts** left NodeMaven for a dedicated FR/Paris IP (FR13–FR20,
  FR2francescu, FR3, FR5, FR31, FR52, FR53 and box-3's FR30, one of the
  wrong-country exits) and **`GB41` got a GB/London port** (its avatar lives
  in the Emirates; UAE ports do not work at the provider, the operator chose a
  UK IP over none — row set to `GB`). 13 FR NodeMaven devices remain (the list
  ran out: FR54–FR63, FR6, FR7, FR8 by name order). The GB ports are **kept
  for box-5** (56 GB devices), 58 free tonight; a US, ES, DE or CA persona
  never gets a GB port — the accounts' country matters more than retiring a
  provider, and the ones still on NodeMaven work.
  **The second hundred was not new**: the full box-3 sweep that followed
  showed 32 of its ports already held on box-3 (29 by DE / ES / US / CA
  personas — the box's original provisioning, in-guest engine, wrong
  countries), 12 on box-1, 2 on box-4, 1 on box-2. The planner had seen them
  through the DB mirror and handed out only free ports — except **one**:
  `CA1` had read "no proxy" at 13:10 and held `8138` all along, so `8138`
  went to FR17 as well. Cause: `proxy_get` on the in-guest engine answers
  "no proxy" for a configured device now and then (4 per box-3 pass, ES30 /
  ES31 tonight). Fixed twice: CA1's proxy released (`proxy_stop`, no avatar,
  wrong country anyway — FR17 keeps its proven port), and `readProxyConfig`
  asks again 8 s later before clearing a row the mirror knows as proxied.
- **Same evening — six dead devices of box-1 recreated** (`replace_devinfo`,
  corrupt `/data`, see `infra/boxes/MAINTENANCE.md` § 2): five boot again
  (ES8, FR4, US2, US42, US8), FR10 waits for its `starting` phase to clear.
  The wipe clears the proxy too (ES8 had a GB port; free again). They have no
  proxy and no port of their country exists — the sweep now opens a
  `proxy_incoherent` "has no proxy" item for a device that boots without one
  (`sweep-findings.mjs`), five opened.
- **box-5**: `maintenance_until = 2027-12-31` set on its row (the arbiter
  refuses every start of ours the day it answers again); its power-on
  protocol is in `infra/boxes/MAINTENANCE.md` § 6.

What to order to finish (26 September 2026, night; the four online boxes +
box-5's personas, +10 %):

| Country | devices | to order | why |
|---|---:|---:|---|
| US | 149 | **164** | 94 NodeMaven, 38 wrong exits on box-3, 7 without a proxy (4 spares, US2/US42/US8 recreated), box-5's 10 |
| ES | 51 | **56** | 35 NodeMaven, 12 wrong exits on box-3, 3 spares, ES8 recreated |
| FR | 44 | **48** | 13 NodeMaven, FR4 + FR10 recreated, box-5's 29 |
| DE | 20 | **22** | 12 NodeMaven, 8 wrong exits on box-3 |
| CA | 5 | **6** | CA5 NodeMaven, 3 wrong exits on box-3, CA1 spare |
| **total** | **269** | **296** | GB is done: 59 GB ports free, 56 of them box-5's |

Where the online fleet stands after this day (352 devices): **184 on the
list / Oxylabs dedicated, 155 on NodeMaven** (US 94, ES 35, FR 13, DE 12,
CA 1 — all on the one profile, all proven), 13 without a proxy (8 spares
without an avatar, 5 recreated tonight), 1 dead (FR10, recreation pending),
**142 job-capable** (boots + IME + at least one social app).

`--reclaim-offline` is what made the first list usable (box-5 held all 100
ports on paper) and what makes box-5's re-provisioning mandatory before it
runs a container again.

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
