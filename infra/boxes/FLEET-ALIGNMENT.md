# Fleet alignment & gated live actions

Canonical list of fleet-alignment findings and the **gated** live actions to
resolve them. "Gated" = touches a live box or the Cloudflare control plane, so
it is executed only on explicit approval, never as a side effect of a deploy.

## Snapshot — 25 September 2026, Phase 0 (stabilisation, 20:40–21:05 Paris)

The four L1 boxes were moved onto the operator's LAN (`192.168.1.0/24`, DHCP)
earlier that evening. Measured over the LAN (`GET /v1/get_hardware_cfg`,
`/v1/systeminfo`, SSH) and the tunnel (`/healthz`):

| box | LAN IP (DHCP) | MAC | device_id | CBS | kernel | RAM | containers | tunnel |
|---|---|---|---|---|---|---|---|---|
| box-1 | 192.168.1.27 | 70:b3:d5:1a:75:c9 | 6d9d218d5e9f81e8 | 1.1.6.12.1 | 1.0.86_marsbox (5.10) | 32 GB | 96 | 200 |
| box-2 | 192.168.1.19 | 70:b3:d5:1a:79:6a | 70971fb475860f90 | 1.1.4.30.1 | 2.0.30_marsbox (6.1) | 16 GB | 57 | 200 |
| box-3 | 192.168.1.32 | 70:b3:d5:1a:79:36 | 0bf98dd5f21e135f | 1.1.4.30.1 | 2.0.30_marsbox | 16 GB | 126 | 200 |
| box-4 | 192.168.1.237 | 70:b3:d5:1a:79:b1 | dab22f1488034ec7 | 1.1.4.30.1 | 2.0.30_marsbox | 16 GB | 73 | 503 → 200 |
| box-5 | — (absent from LAN) | — | — | 1.1.6.29.1 (last seen) | 2.0.57_k1 | — | 100 (DB) | 1033 |

Common to the four: hostname `marsbox`, TZ `Asia/Shanghai`, `LANG=zh_CN.UTF-8`,
DNS `114.114.114.114`, Debian 11, Docker 20.10.18, Node v20.20.2 (EOL),
cloudflared 2026.6.1, magicbox-proxy 1.2.0, `cbs_go` supervised by
`supervisord` (not systemd), `cbs_go` listening on the LAN IP only (never
`127.0.0.1`), IPv6 global address present, sshd root-by-password on `0.0.0.0:22`
and `[::]:22`.

What Phase 0 changed (all reversible, nothing destroyed):

- **box-4** — `/etc/magicbox-proxy.env` still carried the previous DHCP lease
  (`API_HOST=192.168.1.16`, `EHOSTUNREACH`); rewritten to `192.168.1.237`
  (previous file kept as `.bak.<ts>` on the box), `magicbox-proxy` restarted,
  `/healthz` 200 with 73 containers, `boxes.status` back to `online` at the next
  reconcile (18:55 UTC). This is the last time an IP is written by hand: Phase 1
  removes the file (the proxy resolves the API host from the default-route
  interface).
- **box-1** — maintenance paused globally 20:49–21:01 (`maintenance.global_enabled`
  false → true; there is no per-box switch yet, see Phase 3). The three running
  sessions finished on their own; the leftover containers were stopped one by
  one through `POST /container_api/v1/stop` → 96/96 stopped. `vm.swappiness`
  100 → 10, persisted in `/etc/sysctl.d/90-attila.conf`. `GET /v1/prune_images`
  freed 5 941 MB (images `android15_20260212`, `android13_20260131`, unused).
  `mihomo.log` of stopped containers truncated: 91 files, 3.3 GB (one file was
  1.46 GB). Removed `/root/upgrades/cbs/…/cbs_go.new` (byte-identical to the
  live `cbs_go`, 210 MB) and `/root/attila-webapp.service.bak.20260421-190018`.
  **Kept** `/root/upgrades/cbs/20260623_005839/cbs_go.pre-upgrade` (147 MB,
  md5 `48bddc02…`): the binary box-1 ran before the 23 June CBS upgrade,
  distinct from `cbs_go.backup` (11 May build, md5 `963a55f2…`) — a second
  rollback point for the CBS line.
  Result: load average 192 (20:00) → 4.1 (21:00); swap 3.7 GB → 42 MB; root
  eMMC 77 % → 38 %; `state/` directory 3.4 GB → 7 MB.
- **box-2** — `GET /v1/prune_images` freed 3 250 MB (`android13_20260307`), root
  43 % → 30 %, 57 containers intact.
- **manifest.tsv** — box-3 and box-4 `api_host` corrected (interim; the column
  disappears in Phase 1).

Facts measured during Phase 0 that the plan did not have:

- **box-1 SSD is at 80 %** (`/container_nswc_lv` 352/469 GB) — above the 75 %
  warning of `fleet-reference.json`. The offline reclaim pass of §1 in
  `MAINTENANCE.md` is due again on box-1.
- **Who set `vm.swappiness=100` on box-1** is not the firmware: the vendor's
  `zram-init.service` writes `10` at every boot (proven in the boot journal) and
  box-2/3/4 stay at 10. `cbs_go` 1.1.6.12.1 carries an undocumented route
  `/swappiness/set` (binary strings). Hypothesis: CBS 1.1.6.x swap management
  raises it at runtime. To verify after the Phase 2 canary; `check-drift`
  gains a runtime `swappiness` check in Phase 1 so a re-flip is caught.
- **`mihomo.log` grows because cbs_go writes `mihomo.json` with
  `"log-level": "debug"`**: 66 % of lines are `[Rule]`/`[Sniffer]` debug, the
  rest one `info` line per connection — and every UDP/QUIC attempt from TikTok
  is `REJECT`ed by rule, so a device retrying QUIC writes two lines per attempt.
  mihomo runs on the **host** (one process per running container). `proxy_set`
  has no log-level parameter, so the fix is host-side rotation (Phase 1) plus a
  vendor question.
- **`/interface_logs/stats` is not empty on 1.1.6.12.1** (the plan said it
  was): 5 categories — adb exec 380 991 calls, proxy set 422, proxy stop 252,
  upgrade image 2, delete instance 1 (0 % success). `/recent` returns 20 rows
  with a method label and a status only, no path.
- **One ghost device row on box-1**: `EDGEOFXMNKGJR87N` (US4, one avatar) is
  in the database, not on the box. `check-drift` reports 96 live / 97 in DB.
- **cbs_go pushes its built-in `scd` (build 15) into containers at start**
  (`CheckAndUpdateSCD` in its log) — relevant to the `scd_config` question.
- The 30 untyped maintenance failures of the last 7 days classify into three
  causes (see Phase 3 in the plan): 23 × v2 route to a stale Docker IP during
  `input/scroll_bezier`, 5 × container stopped under a running session (the
  reaper does not know about maintenance tasks and `openDeviceSession` only
  refreshes `last_seen` when it started the container), 2 × tunnel 502/timeout.

`box-5` (K1 hardware despite `model = E1.01`) and `box-6` (empty row from July)
are out of scope for this session.

## Snapshot — 25 September 2026, Phase 1 (IaC portable + hygiene + runtime, 21:05–22:00 Paris)

Rolled with `./scripts/deploy.sh` over the LAN, canary box-2 (38 s), then box-3,
box-4, box-1 (in a 3-minute maintenance pause). `check-drift.mjs` after the
rollout:

| | box-1 | box-2 | box-3 | box-4 |
|---|---|---|---|---|
| magicbox-proxy | 1.3.0 | 1.3.0 | 1.3.0 | 1.3.0 |
| proxy `api_source` | `default_route` | `default_route` | `default_route` | `default_route` |
| cloudflared | 2026.9.3 | 2026.9.3 | 2026.9.3 | 2026.9.3 |
| Node (proxy runtime) | v24.21.0 | v24.21.0 | v24.21.0 | v24.21.0 |
| hostname · TZ · LANG | box-1 · Europe/Paris · en_US.UTF-8 | box-2 · … | box-3 · … | box-4 · … |
| resolvers | 1.1.1.1, 8.8.8.8 | same | same | same |
| swappiness (runtime) | 10 (timer) | 10 | 10 | 10 |
| journal | 280 MB | 312 MB | 296 MB | 248 MB |
| pinned IP (env file / drop-in) | none (both removed) | none | none | none |
| fleet key | authorized | authorized | authorized | authorized |
| managed files | current | current | current | current |

Summary line of the checker: **proxy 4/4 · cloudflared 4/4 · node 4/4 ·
hygiene 4/4**; exit 2 for four items that are not Phase 1's:

- `orphan SSD dirs: box-4` — `EDGEUSBP66ZTYMNV` (gated cleanup).
- `lan_ip stale in DB: box-4` — `boxes.lan_ip` still `192.168.1.16`; Phase 3's
  presence writer persists `/v1/net_info`.
- `inventory drift: box-1` — the ghost `EDGEOFXMNKGJR87N`; Phase 3's reconcile
  marks `removed`.
- `disk warn: box-1` — SSD 80 %; the offline reclaim pass (§1 of
  `MAINTENANCE.md`) is due, in a quiet window.

Found and fixed on the way:

- **box-1 carried a second pinned IP**: a pre-IaC systemd drop-in
  `magicbox-proxy.service.d/override.conf` (21 April 2026) with
  `Environment=API_HOST=192.168.1.27` that every deploy since had left in
  place. The proxy reported `api_source: override` after the first converge;
  `deploy.sh` now removes the drop-in directory and `check-drift` reads the
  unit's effective `Environment`.
- **magicbox-proxy 1.2.0 could hang a `/stream-ready` probe forever**: a scrcpy
  port that accepts and then closes cleanly (FIN, no RST) fired neither
  `error` nor `timeout`. Found by the new contract test; fixed in 1.3.0.
- **`vm.swappiness` on box-1 is raised by the Android guests** (privileged
  containers, `init.rc` writes 100; leaks through the 5.10 kernel, not through
  6.1 — tested on box-2 with a running container). `attila-sysctl.timer`
  re-asserts 10 every minute until the kernel upgrade.
- **cbs_go pins the DHCP lease into NetworkManager** (`StaticIPManager`,
  `ipv4.method manual`, DNS 114.114.114.114) at every boot — host DNS is
  therefore managed with `dns=none` + our `resolv.conf`.
- **The fleet key is passphrase-protected and not in the agent** on the
  operator's Mac: key auth is accepted by every box (server accepts the key)
  but the client cannot sign; deploys fall back to the password and
  `--lock-root-password` correctly refuses to run. `ssh-add
  --apple-use-keychain ~/.ssh/id_ed25519_attila` is the one-time fix.
- **sshd on the boxes intermittently refuses a password login** right after
  another session; the tooling retries once.

Canary smoke on box-2 through the new proxy (FR31, avatar-free): `run` →
`/stream-ready` `ready` at 13 s → `sys.boot_completed=1` → `/proxy-test`
`ok, 1602 ms` → v2 agent `1.1.1` → `stop`.

### The three usages, replayed after Phase 1 (box-2, 22:00–23:00 Paris)

- **Operator web** (production `attila-yew3.onrender.com`, admin session, the
  same `nativeRoute` surfaces the UI and the Mac use): `POST …/start` 200 in
  2.5 s; `/api/box/…/stream-ready` `ready`; the `/ws/stream/…/video` WebSocket
  through Render → tunnel → proxy 1.3.0 → scrcpy opened in 725 ms with the
  first frame at 927 ms (device `SM-S9010`); `setprop ctl.restart scd` then
  `POST …/stream/reload` 200 (4.7 s) with `/stream-ready` back to `ready`;
  `POST …/proxy/verify` → socks5 `gate.nodemaven.com:1080`, reachable 910 ms;
  the hands — `tap` by selector on the Settings search field, `type "wifi"`
  through ADBKeyboard (4 chars, results on screen, Gboard restored), `press
  back/home`; `POST …/stop` 200 in 0.7 s. The admin Infrastructure page on the
  local dev server showed the six boxes with the same states as `check-drift`.
  (Local `npm run dev` gained `WORKERS_ENABLED=0` so a dev server against the
  production database no longer runs a second set of worker loops.)
- **Operator Mac**: `make build` and `make test` green (323 tests); the gated
  live decode suite (`ATTILA_LIVE=1`, real H.264 → `CMSampleBuffer` and Opus →
  PCM against US23 on box-2) passed in 0.84 s and 1.09 s. The MCP cockpit was
  "unreachable" because a two-day-old `Attila 2.app` instance held port 7431
  without answering; the fresh Debug build answers (`attila 0.3.0`, 35 tools,
  `boxes` → 6 boxes / 4 online with live heartbeats).
- **Opérateur IA** (ES14 / Yassine Benomar, pilot avatar): `probe` →
  `logged_in` in 19.5 s (TikTok 44.8.3, agent 1.1.1, `feed_ok`); a 3-minute
  supervised `social_session` claimed and run by the **Render** Maintain
  worker → `session_done`, 5 steps, 10 scrolls, 0 dialogs. Two defects of
  `scripts/maintenance-task.ts` surfaced: it cannot claim its own row while
  another task holds the device (one-task-per-device rule) and it would leave
  a foreign claimed row `running` — Phase 3 fixes both (claim by id).
- **Automator** (US23 / DeShawn Parker): **X reply posted** on X 11.97.0 —
  `post_detail` → typed via ADBKeyboard → positive signal
  `posted_item_after_scroll` in 30.2 s, cross-checked on TikHub 60 s later
  (`@NatGeo that penguin has more swagger than most people`, 20:56:40 UTC),
  one `avatar_actions` row (`operator`, `reply`). **TikTok comment refused**
  on TikTok 45.0.3 + agent 1.1.1: first attempt `app_not_ready` (the side
  action bar was absent from the tree right after the deep link), second
  attempt reached the composer, typed, then `rate_limited` — the expanded
  composer is not in the (stale) tree and `tiktok.send_button` has no 45.0.3
  seed, so nothing was sent (comment count unchanged, 29). No false `done`;
  the gap is the engine's selector table, not the box (Phase 3/4).

Vendor facts confirmed from `help.vmosedge.com` (image-release-history,
firmware-download, both re-read that evening): CBS `1.1.7.17.1` + image
`vcloud_android13_edge_20260717112129` (17 July) are the last releases with no
model restriction; 24 July onward is L20-only, then K30-only; the last L1
firmware is `update_2.0.61_marsbox_20260703.img` (kernel 2.0.61, CBS 1.1.7.2.1,
full flash, erases data); kernel-only `boot-2.0.57-marsbox.img` (61 023 232 B,
5 June); CBS `1.1.7.17.1` is 211 228 000 B. All three download URLs answered
200 that evening.

## Snapshot — 25 September 2026, Phase 3 (backend, 23:00–23:45 Paris)

Commit `ad34715`, Render deploy `dep-darej7gu01pc73e4kuv0` built in 88 s and
`live` at 21:39:03 UTC. Measured on the production database afterwards:

- **One presence writer.** The first reconcile pass (21:39:01 UTC, three
  seconds after `live`) wrote the observed facts on the four reachable boxes:
  `lan_ip` (box-4 `192.168.1.237` — the DB had carried the pre-move `.32`
  since the afternoon), `model L1`, `cbs_version` / `kernel_version` /
  `default_image` (`firmware_checked_at` set, re-read hourly), and
  `host_health` sampled every pass (`cpu 0.6–6.8 %`, `mem 2.5–10.2 %`,
  `swap 0–0.9 %`, `mmc 7–27 %`, `ssd 10–75 %`, `running` / `starting`).
  box-5 (unreachable) and box-6 (decommissioned row) are untouched: the
  writer only records what it observed.
- **Inventory.** The ghost `EDGEOFXMNKGJR87N` (box-1, US4 — in the DB since
  the 14 September Sync, never on the box) was marked `removed` at 21:39:06
  UTC by the worker; the admin Sync and the worker now share
  `reconcileDeviceRows`. Live/DB inventory: 96/96, 57/57, 126/126, 73/73.
- **check-drift** (exit 2, only gated items left): `lan_ip OK observed /
  db` on the four boxes; still `[!]` box-1 SSD 75 % (reclaim pass is a
  decision) and the box-4 orphan `EDGEUSBP66ZTYMNV` (gated); `[gated]` root
  password SSH; `(i)` image / CBS / kernel drift for Phase 2.
- **Fleet scripts over the LAN.** `scripts/lib/fleet.mjs` (`boxFetch`) and
  `scripts/lib/box-ssh.mjs` (`runOverSsh`) resolve the box on the LAN by MAC +
  `device_id` first and fall back to the tunnel; proxy-only paths (`/healthz`,
  `/stream-ready/`, `/proxy-test/`) stay on the tunnel by construction. The
  offline package audit of 352 devices on four boxes took **126 s** (it was a
  tunnel job of many minutes): ADBKeyboard 338 (96 %), TikTok 144, X 144,
  **208 devices with no social app** — box-3 alone has 107 of them.

## Snapshot — 26 September 2026, proxies (13:10–15:30 Paris)

The operator's list: 100 Oxylabs dedicated ports, GB 60 / FR 30 / US 10.
`scripts/assign-proxies.ts` moved **47 devices** to the one profile (host
engine, UDP off, DNS through the exit), two boots per box, each proven on the
same boot; an independent `audit-device-health --with-proxy` pass afterwards:
**44/44 routing, 0 mismatch, 0 unproxied** (43 exits read). Attention items:
9 refreshed, 4 resolved by re-probe, the box-3 item down to 61 devices.

Four vendor behaviours measured and put into code on the way:
`proxy_set` across engines is refused ("存在不同引擎的代理正在运行中") →
`setProxyConfig` stops the in-guest engine first; `proxy_get` on a device
with no proxy is `code 200` without `proxy_config` → `enabled: false`, not
"cannot be asked"; cbs_go acknowledges `proxy_set` seconds before the engine
reloads → read back until the device reports the written upstream; and **a
running host-engine device loses its guest egress after `proxy_set` until it
reboots** → the operator core restarts the container (`restartContainer`:
stop → stopped → run) and every surface says so. magicbox-proxy **1.3.3**
measures the guest's exit on the host-engine path too. Three ways in
(Cursor script, Attila MCP `device_proxy`, web/Mac inspector), one engine
underneath — the MCP way was exercised live from Cursor (start, verify,
stop on US23), the route way on production (US32: `engine host`, `exit
US/New York City 48.47.5.11`).

## Snapshot — 26 September 2026, proxies, second pass (15:30–17:40 Paris)

- **211 NodeMaven devices re-written on the one profile**, same IP: 210
  `OK`, 1 `MISMATCH` (`GB41`, row says CN). box-1's Cloudflare tunnel dropped
  around 14:52 for a few minutes (`cloudflared` "context canceled"; cbs_go up
  since 25 September 19:38, never restarted) — everything riding it failed in
  that window (32 devices), all `OK` once re-run; the three devices busy with a
  maintenance task at plan time and FR5 (slow under load, 15 s alone) `OK`.
- **48 devices moved onto the list**: 45 GB (incl. the two parked probes,
  now `GB`) → GB/London, 3 FR → FR/Paris, all proven on the same boot.
  FR10 (box-1, `dead` since 25 September) refused to boot twice; it sits in
  `starting` again until reconcile + reaper clear it.
- **Fleet (352 devices online): 170 on the list, 170 on NodeMaven (US 94,
  ES 35, FR 27, DE 12, CA 1, GB41), 12 without a proxy (4 dead, 8
  avatar-less spares on box-3).** box-3 wrong-country exits: 61 left. To
  order: US 150, ES 55, FR 30, DE 22, CA 6, AE 1 (see `PROXY-STRATEGY.md`).
- Two defects found by the tooling, fixed and tested before anything ran:
  the planner could hand a port to a device sorted before its holder
  (caught by `--dry-run`); reservations are now fleet-wide with
  `--reclaim-offline` explicit (100 ports recorded on box-5). And
  `record-sweep-attention.ts` resolved nothing by re-probe since it was
  written — the resolve target lacked the box the key carries; fixed, 7
  stale `proxy_incoherent` items closed from the verification sweeps.
- Measured, not assumed: a host-engine device (FR18) exits through its
  proxy from the first shell answer (+22 s, before `boot_completed`), 22
  readings, 0 through the box. The vendor's mihomo config keeps `DIRECT` in
  the group and resolves with its own DNS list (`223.5.5.5` first) whatever
  `dnsServers` we send — two questions for VMOS, in `PROXY-STRATEGY.md`.
- Nothing of ours left running after the passes (checked on the four boxes
  at 17:40): box-2/3/4 all stopped; box-1 has US36 running for the Maintain
  worker's own `probe` task and FR10 in `starting`.

## Snapshot — 26 September 2026, evening (19:30–21:00 Paris): the operator's go on five gates

- **Proxies, second hundred** (`8101–8200`, FR 30 / GB 70, same account,
  three ports proven from the Mac first): 15 FR devices with live accounts off
  NodeMaven onto FR/Paris ports, `GB41` onto GB/London (its row `CN` → `GB`;
  UAE ports do not work at the provider), FR5 alone after a third
  `boot_timeout` under load (58 s alone: a slow device, not a dead one). GB
  ports kept for box-5. Online fleet: 184 dedicated / 155 NodeMaven / 13
  without / 1 dead; **142 job-capable**. Order to finish in
  `PROXY-STRATEGY.md` (US 164, ES 56, FR 48, DE 22, CA 6).
- **box-5** (off since 21 September, 100 containers on the first hundred
  ports): `maintenance_until = 2027-12-31` on its row — the arbiter refuses
  every start of ours the day it answers; power-on protocol written
  (`MAINTENANCE.md` § 6). Not on the LAN, tunnel 530.
- **Six dead devices of box-1**: cause read from inside — corrupt
  `/data/system/packages.xml`, `system_server` in a crash loop; `reset`
  refuses a non-booted instance, `recreate_container` keeps the corruption;
  **`replace_devinfo` (wipe, same identity template `1125` Samsung SM-S9010,
  persona locale/timezone/country) brought five back** in 150–170 s each
  (ES8, FR4, US2, US42, US8: 16–22 s boots, ADBKeyboard installed, no social
  app, no proxy; `boot_dead` items resolved by re-probe, five "has no proxy"
  items opened). FR10 refuses while in `starting`; one command once it clears.
  Every delete-class action on a container stays forbidden except this one,
  on the operator's explicit word.
- **Device capability enforced**: `deviceIncapability()` (one rule, nine
  tests) in the campaign selector, the maintenance planner and the
  directed-action route — a dead device, a device without the IME or without
  the app is not handed work any more. The Mac decodes the new skip reason
  `unfit_device` (resilient string).
- **Point-8 gates**: `box-6` row deleted (0 devices, 0 shares, offline since
  8 July); the box-4 orphan directory `EDGEUSBP66ZTYMNV` removed (12 KB, an
  empty `debug_ramdisk` of 18 May, in no container, no mount, no vendor DB);
  **sshd on IPv4 only on the four boxes** (`50-attila-inet.conf`, deployed
  canary-first, `[::]:22` gone, tunnel SSH intact; `check-drift` fails on it
  from now on). `--lock-root-password` still waits for the passphrase-protected
  key to enter the agent (`ssh-add --apple-use-keychain ~/.ssh/id_ed25519_attila`,
  the operator's keyboard).
- **Two tooling lessons paid tonight**: `install-adbkeyboard.mjs` without
  `--missing-only` boots the whole box one device at a time (aborted after
  three, containers stopped by hand; the runbook now says so); the boxes'
  sshd refused the root password on two boxes for ~10 minutes then accepted
  it again (faillock-like; nothing changed on our side).
- `check-drift`: hygiene converged 4/4, orphans none; `[!]` box-1 SSD 75 %
  remains a decision (337 of 469 GB, 96 containers of 3–9.5 GB — usage, not
  waste); `(i)` image / CBS / kernel for box-1 (Phase 2 gated).
- **Full box-3 sweep (21:00–21:30, the last LAN hour)**: 126/126 healthy,
  63 wrong-country exits, 6 without a proxy; the box-scoped item refreshed
  with the list. It also showed the second proxy hundred was box-3's original
  allocation in part (32 ports), and caught one collision my afternoon read
  had created (`8138`: CA1 read "no proxy" at 13:10 — the in-guest engine's
  intermittent answer — so FR17 got it too): CA1 released, the probe now
  re-reads before clearing a mirrored proxy. Full account in
  `PROXY-STRATEGY.md`.

## Snapshot — 26 September 2026, Phase 2 (vendor firmware, 07:55–08:35 Paris)

GO given at 07:56. Three L1 boxes brought to the vendor's last L1 targets,
one at a time, canary first, each under a 2-hour maintenance window (arbiter
refusing, reaper skipping, status held), all containers stopped, our own copy
of the running `cbs_go` taken first.

| Box | kernel flash → API back | new lease | CBS upload / restart | containers | validation boots |
|---|---|---|---|---|---|
| box-2 | 05:58Z → ~90 s | **.19 → .68** | 19 s / 25 s | 57 / 57 | US23 33 s, GB12 15 s |
| box-3 | 06:19Z → 34 s | no | 20 s / 25 s | 126 / 126 | GB27 26 s, US118 10 s |
| box-4 | 06:23Z → 46 s | no | 22 s / 25 s | 73 / 73 | US63 24 s, US85 10 s |

Every validation boot: `/stream-ready` `ready`, v2 agent answers (1.1.1 on
box-2/3, 1.1.3 on box-4), `/proxy-test` routes (host engine 690–1544 ms;
GB27's in-guest engine 1204 ms, exit GB/London). Production Operator path on
box-2 after the window closed: `POST …/start` 200 in 2.1 s, `stop` 200.
`check-drift`: `cbs OK 1.1.7.17.1`, `kernel OK 2.0.57_marsbox`, all managed
files current on the three boxes — the overlay upper (`/userdata`, a real
partition) survived the reboots, as did `/opt`. **3/4 boxes on the vendor
target**; box-1 stays at CBS 1.1.6.12.1 / kernel 1.0.86 until VMOS answers.

Measured along the way:

- **A kernel flash can change the DHCP lease.** box-2 came back on
  `192.168.1.68`; nothing noticed except the poll loop that waited on `.19`.
  The proxy resolved the new address itself (`api_source default_route`), the
  presence writer recorded it, LAN discovery by MAC found the box. This is
  the scenario the zero-IP rule was written for; it held.
- **CBS 1.1.7.17.1 listens on `*:18182`** (1.1.4.x bound the LAN IP only), so
  `127.0.0.1:18182` answers again on the upgraded boxes; `/v1/systeminfo`
  now returns `cbs_version`; the updater leaves `cbs_go.backup` = the
  previous binary (147 MB) next to itself — a real rollback for the CBS step.
- `/etc/docker/daemon.json` differs per box since provisioning (box-1/2:
  `data-root /userdata/docker` on the 26 GB eMMC partition; box-3/4:
  `/container_nswc_lv/docker` on the NVMe). Dated 18 April 2026 on box-2 —
  not a Phase 2 effect. A fleet-uniformity item for later, not urgent
  (3.3 GB used, 19 GB free).
- `proxy_get` exposes the engine placement as `engineType`: **1 = host-side
  mihomo** (`nodes[]`, `proxyMode: proxy`), **0 = in-guest clash** (the
  `blockUntilReady` / `proxyDnsServers` family). Our `setProxyConfig` never
  sent it; the unification pass will send `engineType: 1`.

## Snapshot — 26 September 2026, Phase 4 (devices, 00:00–01:30 Paris) and Phase 5 (cockpits)

**One boot per device.** `audit-device-health.mjs --with-proxy`, one process
per box, two starts in flight each, LAN-first (`fleet.mjs`, `box-ssh.mjs`):
351 devices booted between 23:55 and 00:45; median healthy boot 15 s on
box-2/3/4, 25 s on box-1 (kernel 5.10). `boot_health` re-recorded for all.

| Box | booted | healthy | dead (serial re-probe) | ADBKeyboard | social app | job-capable |
|---|---:|---:|---|---:|---:|---:|
| box-1 | 95 | 89 | **6** — ES8, FR10, FR4, US2, US42, US8 | 94 → 94 | 61 | 61 |
| box-2 | 57 | 57 | 0 (US11 read dead alone at 23:55, healthy at 00:20) | 56 → 57 | 44 | 44 |
| box-3 | 126 | 126 | 0 | 117 → 126 | 19 | 19 |
| box-4 | 73 | 73 | 0 | 71 → 73 | 22 | 22 |

- **Booting a dead device costs the box.** The six box-1 devices went from
  `stopped` to VMOS `starting`, crash-looping (Docker "Up About a minute",
  again and again), `stop` refused (`code 2`), load average 14.8 with nothing
  useful running. The sweep now leaves known-dead devices alone unless
  `--recheck`; `fetchRunningDbIds()` counts `starting` as an occupied slot; a
  patient `stop` loop (2-minute period, 6-hour horizon, MAINTENANCE.md § "the
  `starting` deadlock") was left running on the five still looping at 01:30.
- **ADBKeyboard**: 12 of the 14 missing installed (`--missing-only
  --concurrency 1`); the two failures (FR4, US2) are dead devices. Fleet
  coverage 350/352 on the four boxes.
- **App versions** (offline, LAN, boxes 1/2/4 — box-3 after its installs):
  X present on 58 (of 91 scanned) + 44 + 20 devices, TikTok on 57 + 44 + 21; box-1 alone has
  ten X builds from 11.82 to 12.24 and TikTok 44.6.4 on 23 devices.
- **`aosp_version` / `agent_line` seeded from the image** where never read
  (203 and 237 rows): `20260307` → agent 1.0.8 (box-1 — an older line than
  documented), `20260417` → 1.1.1, `20260511` → 1.1.3; `agent_checked_at`
  left null so the engine's `base/version_info` read still wins.
- **Proxies** — the full picture is in `PROXY-STRATEGY.md` § "Measured on
  the whole fleet": two engine placements (host-side mihomo vs in-guest clash
  on a TUN), a 15–20 s unproxied window after every boot in the in-guest
  mode, 85 of box-3's 104 checked devices exiting in the wrong country, six
  NodeMaven engines `DOWN`. magicbox-proxy went to **1.3.2** (guest probe,
  `engine`, `exit`, `engine_starting`, `unproxied`; fixture
  `proxy-test.json`) and was redeployed on the four boxes in under a minute
  each. Fifteen attention items opened (`record-sweep-attention.ts`): six
  `boot_dead`, eight device `proxy_incoherent`, one box-scoped item for
  box-3's 85.

**Phase 5, measured on production** (deploy `5ca4baf`, live 22:25 UTC):
`POST /api/devices/{US23}/start` during a 10-minute window answered
`{"error":null,"refused":"box_maintenance","refusedDetail":"2026-09-25T22:36:44…","max":10}`
in 0.9 s and the container stayed `stopped` on the box; the admin page
shows the presence and verdict badges, the gauges, the firmware facts and the
maintenance window (opened and closed from the UI, `maintenance_until`
followed in the database). Web: 178 tests, 0 lint errors; macOS: 0 failures,
`make build` exit 0, the four vocabularies pinned to their fixtures on both
sides.

Run the read-only checker any time to regenerate the live picture:

```bash
CLOUDFLARE_API_TOKEN=… node infra/boxes/scripts/check-drift.mjs
```

## 1. Naming inconsistencies (cosmetic, low risk)

These do not affect routing (DNS + ingress are correct and iso) but break the
"everything is `box-N`" mental model and make automation/greps brittle.

- **Tunnel name**: box-1's Cloudflare tunnel is named `magicbox`; boxes 2/4/5
  are `box-N`. Cloudflare tunnels can be renamed without re-issuing credentials
  (the tunnel **id** — used by DNS + `manifest.tsv` — is unchanged), so this is
  a safe rename. Gated: rename `magicbox` → `box-1` in the Cloudflare dashboard/API.
- **DB display name**: `boxes.name` is `"Box 1"` for box-1 but
  `"box-N.attila.army"` for the others. Gated (DB): normalize to a single
  convention (recommend the bare hostname `box-1.attila.army`, matching 2/4/5).
- **Legacy DNS record**: `ssh.attila.army` is a proxied CNAME to box-1's tunnel
  (`676c636f-….cfargotunnel.com`) — a pre-`ssh-box-N` leftover. Confirm nothing
  depends on it, then gated: delete the `ssh.attila.army` record.

## 2. Remote-managed tunnel config (second source of truth)

Every tunnel (1/2/4/5) carries a **remote** (dashboard/API) ingress config
(`configurations` version ≥1; box-1 is at v6). Because `cloudflared` runs with
`--config /etc/cloudflared/config.yml`, the **local** versioned file wins and
the remote config is inert — but it is a competing source of truth that can
mislead future edits.

Gated (Cloudflare API): delete the remote configuration for each tunnel so the
box's local `config.yml` (rendered from `templates/cloudflared.config.yml.tmpl`)
is unambiguously the only source. Read-only detection is already in
`check-drift.mjs` (`remote-cfg` line + `[gated] remote tunnel cfg` summary).

## 3. Version pins (repo = target)

Golden targets are pinned in [`fleet-reference.json`](fleet-reference.json)
(re-pinned 25 September 2026 — the lines below record the history):

- `android_image.golden` = `vcloud_android13_edge_20260717112129` (candidate, last image without a model restriction; not yet validated on a device)
- `vendor_by_model.L1`    = cbs `1.1.7.17.1` (fallback `1.1.7.2.1`), kernel `2.0.57_marsbox` — the vendor's last L1 releases
- `vendor_by_model.E1.01` = cbs `1.1.6.29.1`, kernel `2.0.57_k1` (K1 hardware; box-5 out of scope)
- `runtime.cloudflared`  = `2026.9.3`, `runtime.node` = `24.21.0` (sha256 pinned)
- `magicbox-proxy`       = read live from `infra/magicbox-proxy/package.json` (v1.3.0)

Before 25 September 2026 the pins were: image `20260626203150`, L1 = the
composite of the highest versions observed (cbs `1.1.6.12.1`, kernel
`2.0.30_marsbox`), cloudflared `2026.6.1`, proxy `1.1.0` → `1.2.0`.

> **Corrected 2026-08-31.** This file previously pinned a single global vendor
> target taken from box-5, and the checker reported "1/5 on golden kernel". That
> was wrong: box-5 is an **E1.01** host while box-1..4 are **L1**, and the two
> families do not share a kernel. Read against per-model baselines, the fleet is
> **4/5 on kernel** — only box-1 is genuinely behind, on `1.0.86_marsbox` against
> the L1 target `2.0.30_marsbox`. The L1 CBS target is a composite: box-1 leads on
> CBS (`1.1.6.12.1`) while box-2/3/4 lead on kernel, so no single L1 box is on
> target yet.

Live drift today (see checker): **box-5** matches its model's vendor baseline and
the golden image. On the L1 side, box-2/3/4 are behind on CBS (`1.1.4.30.1`, the
140 MB binary line, against box-1's 201 MB `1.1.6.x`) and box-1 is behind on
kernel. The old claim that box-2/4 "run a CBS so old it does not even expose
`cbs_version`" was a probe bug, not a box limitation: `/v1/get_hardware_cfg`
reports the version on every box.

- **proxy code** (`magicbox-proxy`): uniform `1.1.0` fleet-wide — already iso,
  shipped by `deploy.sh`.
- **cloudflared binary**: boxes 1/2/4 on `2026.3.0`, box-5 on `2026.6.1`.
  `deploy.sh` installs `cloudflared` but does not pin its version; converging it
  is a gated live action (apt/binary upgrade + `systemctl restart cloudflared`).
- **vendor (image/cbs/kernel)**: converge-forward — see W4 in the plan; no mass
  re-image now.

### Per-box alignment snapshot (2026-07-07, post-convergence)

- **box-1**: image `…20260307170335` ✗ · CBS `1.1.6.12.1` ✗ · kernel `1.0.86_marsbox` ✗ · cloudflared `2026.6.1` ✅ · proxy `1.1.0` ✅ · cap 10 ✅
- **box-2**: image `…20260417164945` ✗ · CBS/kernel not exposed (old CBS) ✗ · cloudflared `2026.6.1` ✅ · proxy `1.1.0` ✅ · cap 10 ✅
- **box-4**: image `…20260511192039` ✗ · CBS/kernel not exposed (old CBS) ✗ · cloudflared `2026.6.1` ✅ · proxy `1.1.0` ✅ · cap 10 ✅
- **box-5**: image `…20260626203150` ✅ · CBS `1.1.6.29.1` ✅ · kernel `2.0.57_k1` ✅ · cloudflared `2026.6.1` ✅ · proxy `1.1.0` ✅ · cap 10 (reference)

Everything we ship or control is now **iso across the fleet**: cloudflared
`2026.6.1`, magicbox-proxy `1.1.0`, config/units, DNS, capacity 10. The only
remaining divergence is the **vendor firmware** (CBS/kernel/Android image) on
boxes 1/2/4 — handled converge-forward (new devices born golden) with a staged
re-image scheduled separately.

## 6. New-device provisioning contract (born-aligned)

The single source of truth for the target image is
[`fleet-reference.json`](fleet-reference.json) → `provisioning.golden_image`
(`vcloud_android13_edge_20260626203150`), which also meets the Android Control
API v2 minimums in `minimums`.

`MagicBox-Industrial` provisioning accepts `--image-repository`; if omitted, VMOS
falls back to an ancient built-in image (drift). So **new devices must be created
with `--image-repository <golden_image>`** (read the value from
`fleet-reference.json`, do not re-hardcode it in the provisioning repo — that
would create a second source of truth). This keeps every newly-created device on
the golden image without a cross-repo copy of the version string. The
creation-time Oxylabs IP/blacklist check (`checkProxyIp`) stays the gate before
hand-off.

## 4. Capacity policy (decision needed)

`max_concurrent_containers` = 10 on box-5, 3 on boxes 1/2/4. This is a
per-hardware decision, so the checker reports it as informational, not a
failure. Decide a fleet policy (per-hardware documented values, or standardize)
and record it; box hardware differs, so "same everywhere" may be wrong.

## 5. Data hygiene (DB, gated)

- `box-3` (offline) still has 7 devices with `state='running'` in the DB that
  were never reconciled when the box went offline. The offline-reconcile added
  in W5 (`markBoxOffline` in the reaper + `syncBox` catch) fixes this going
  forward. A one-shot cleanup for box-3 now (gated):
  `update devices set state='stopped', last_seen=now() where box_id in (select id from boxes where status='offline') and state='running';`

---

# Gated live-mutation checklist

Status legend: ✅ done (2026-07-07) · ⏸ blocked (needs a credential/console I
don't have) · ↩ intentionally skipped.

## A. Cloudflare control plane

1. ✅ **Renamed tunnel `magicbox` → `box-1`** via CF API (tunnel id unchanged, so
   DNS + `manifest.tsv` keep working). All five tunnels now `box-N`.
2. ↩ **Remote-managed tunnel configs** left as-is. `cloudflared` runs with
   `--config /etc/cloudflared/config.yml`, so the local file is authoritative and
   the remote config is inert. Cloudflare exposes no clean DELETE for a tunnel
   configuration (only PUT), so removing it would mean writing an empty/placeholder
   config — a riskier hack than leaving an ignored fallback. `check-drift` keeps
   surfacing it for visibility.
3. ✅ **Deleted legacy DNS record `ssh.attila.army`** (nothing referenced it;
   `ssh-box-N` is the supported form). Verified 0 remaining.

## B. Box convergence (`deploy.sh`, SSH-through-Access) — ✅ done (2026-07-07)

4. ✅ **Re-converged cloudflared config + magicbox-proxy + units** on boxes
   1/2/4/5 via `./scripts/deploy.sh 1 2 4 5`. All health-checked 200 after the
   detached cloudflared restart. proxy stays iso at 1.1.0.
5. ✅ **Upgraded cloudflared `2026.3.0` → `2026.6.1`** on boxes 1/2/4 (box-5 was
   already there). Method: pinned arm64 `.deb` (Debian 11, aarch64) scp'd to the
   box, then a **detached** `dpkg -i` + `systemctl restart cloudflared` (so the
   restart doesn't kill the SSH-through-tunnel session), canary on box-2 first,
   each verified via external `/healthz` + CF-API version. `check-drift` now
   reports cloudflared **4/4 on golden**. Temp files cleaned up.

## C. Vendor convergence (converge-forward; NOT a mass re-image now)

6. ✅ **New devices/boxes**: provisioning contract documented — create with
   `--image-repository <golden_image>` from `fleet-reference.json`. No action on
   existing devices.
7. ⏸ **Optional, staged**: upgrade box-1/2/4 vendor (CBS/kernel/image) toward
   golden via vendor propagation from the reference box. High-impact, per-box,
   scheduled separately.

## D. Proxy fleet (per the strategy)

8. ✅ **End-to-end proxy path validated live** + ✅ **full fleet proxy audit**.
   `scripts/audit-proxy-fleet.mjs` walked every device on the online boxes
   (start → `proxy_get` → write DB truth → stop), repairing the DB mirror that
   only ever learned proxies on running devices. Result (2026-07-07, active
   devices, ghosts excluded):
   - box-1: **92/96 proxied (96%)**  · box-2: **56/57 (98%)**  · box-4: **66/67 (99%)**  · box-5: **100/100 (100%)**
   - Fleet ≈ **314/320 ≈ 98%** — the earlier "5–40%" was a DB-visibility artifact.
   - **47 ghost rows** (DB devices whose `db_id` no longer exists on the box, mostly
     box-5 `US112–US151`) marked `removed` via `scripts/reconcile-devices.mjs`.
   - Genuinely **without a proxy (3)**: `box-1/US42`, `box-4/US56`,
     `box-2/parked_probe_box2_b` (a parked test device).
   - **Unreadable (3)**: `box-1/FR4,US2,US8` — boot_timeout (>120 s). box-1 runs
     the oldest CBS/kernel; slow/stuck boot is a box-1 firmware-health signal,
     tie it to the vendor convergence.
   - Note: box-4 has **73 live containers vs 67 in DB** → ~6 devices created on
     the box but not yet imported into Attila; run admin **Sync** on box-4.
   Tools added: `scripts/audit-proxy-fleet.mjs` (`--dry-run`, `--box`, `--limit`,
   `--only-unproxied`) and `scripts/reconcile-devices.mjs`. *(26 September 2026:
   the fleet proxy audit was retired — `audit-device-health.mjs --with-proxy`
   does the same mirror on the same boot, plus routing and exit geo.)*
9. ~~⏸ **Standardize proxy mode to `vpn`**~~ — **reversed on 26 September 2026**:
   the in-guest (`vpn`) engine leaks the box's address for 15–20 s after every
   boot, the host-side engine does not (`PROXY-STRATEGY.md` § "Measured on the
   whole fleet"). `udpDisabled: true` for the creation profile still stands.

## E. Capacity policy — ✅ done

10. ✅ **Standardized `max_concurrent_containers = 10` fleet-wide** (was box-5=10,
    others=3). Data-backed: box-1 has 32GB RAM, box-2/4 have 16GB like box-5 which
    already runs 10; 10 is the VMOS host ceiling (AGENTS.md). `operator_reserve`
    stays 1. Policy recorded in `fleet-reference.json`.

## F. Database security hardening (advisors)

11. ✅ **Locked service-only functions** (migration `20260707140000`): revoked
    `anon` + `authenticated` EXECUTE on `claim_pending_job`, `claim_pending_post`,
    `enqueue_gorgone_job`, `register_gorgone_event`,
    `list_gorgone_zone_cursors_for_link`, `increment_campaign_counter` (all called
    only via the service-role admin client). `get_device_counts_by_box` locked
    from `anon` earlier (`20260707130000`). Left executable: `is_admin` (RLS) and
    `handle_new_user` (trigger).
12. ⏸ **Enable leaked-password protection** — Supabase Auth setting (Dashboard →
    Authentication → Passwords → "Leaked password protection"). No management-API
    tool available here; one-click toggle for you.
