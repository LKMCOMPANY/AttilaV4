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
   `--only-unproxied`) and `scripts/reconcile-devices.mjs`.
9. ⏸ **Standardize proxy mode to `vpn`** + consider `udpDisabled: true` for the
   creation profile — validate on box-5 first (see `PROXY-STRATEGY.md`). Applied
   at creation in `MagicBox-Industrial`, not from Attila.

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
