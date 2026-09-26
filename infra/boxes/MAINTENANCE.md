# Box maintenance runbook

Operational procedures for the VMOS Edge hosts. Read
[`README.md`](README.md) first for the deploy/drift model, and
[`FLEET-ALIGNMENT.md`](FLEET-ALIGNMENT.md) for version policy.

Everything here is reachable two ways. Over the Cloudflare tunnel: HTTP on
`https://box-N.attila.army` with the CF Access service token, SSH on
`root@ssh-box-N.attila.army` through a `cloudflared access ssh` ProxyCommand —
the only path the Render runtime uses. And, since 25 September 2026, **over the
LAN when the boxes are on it**: `cbs_go` answers on `http://<lan ip>:18182`
(no auth — a trusted-LAN API, never expose it), SSH on `root@<lan ip>`. The
tooling finds the LAN address itself from the MAC + `device_id` in
`manifest.tsv` (`scripts/lib/transport.sh`, `scripts/lib/lan.mjs`); never write
an address down, the boxes are on DHCP and move between offices. An image
import over the LAN takes minutes instead of hours, and a box whose tunnel is
down can still be diagnosed.

## 0. Moving a box (power off / power on)

VMOS restarts at boot **every container that was running when the power went**:
box-1 came back on 25 September 2026 with 8 containers booting at once, 4 GB
each on a 32 GB host — load average 192, zram at 100 %, `kswapd0` at 95 %. So a
box is never just unplugged:

```bash
node scripts/box-power.mjs 2 status            # what runs, what maintenance holds
node scripts/box-power.mjs 2 shutdown --yes    # pause → stop one by one → 0 running → GET /v1/shutdown
```

It pauses the box's maintenance (`boxes.maintenance_until` once Phase 3 has
landed, the global switch otherwise, restored afterwards), waits for running
tasks, stops containers **one at a time** through `POST /container_api/v1/stop`
(a batch with any non-running instance is refused; `starting` ones are waited
for), confirms `list_names` at 0 running / 0 starting, then `GET /v1/shutdown`.
On the next power-up DHCP and the tunnel are enough: cbs_go takes a new lease,
the proxy resolves it, the reconcile worker finds the box within three minutes.

What DHCP means on these hosts: cbs_go's `StaticIPManager` takes the lease at
boot and **pins it** into the NetworkManager profile (`ipv4.method manual`,
`ipv4.addresses`, `ipv4.gateway`, `ipv4.dns 114.114.114.114;8.8.8.8`), while
`/sys/network/config` reports `manual: false`. The address therefore changes
only across a reboot — which the shutdown procedure implies — and the DNS in
the profile is rewritten at every boot, which is why host DNS is handled with
`dns=none` and our own `resolv.conf` (see README).

## 1. Disk pressure — the failure that cost us box-1

### What happened

On 13 June 2026 box-1's `/container_nswc_lv` reached 98% (9 GB free of 469 GB).
Guest ext4 writes began failing with `EIO` (`ext4_check_bdev_write_error` in the
superblock), and **44 of its 96 containers took the filesystem error flag**.
Every other box carried 0 or 1. The consequence was measurable: box-1 finished
**31%** of its jobs where box-4, same RAM, same image family, finished **70%**,
and its worst containers accumulated hundreds of native crash dumps (one had
457 tombstones).

Container data disks are **sparse, grow-only** files. The loop devices are not
mounted with `discard`, so space freed inside Android is never returned to the
host: allocation only ever climbs. On box-1, **40% of the allocated space was
free space the host could not see**.

### The maintenance pass

Fully offline — containers stay stopped, nothing boots, identity is never
touched. Per container:

```bash
e2fsck -fy /container_nswc_lv/$ID/data/data.img     # clears the error flag
losetup -f --show /container_nswc_lv/$ID/data/data.img
mount -o loop,discard /dev/loopN /mnt/_maint
  rm -rf /mnt/_maint/tombstones/* /mnt/_maint/anr/*   # crash artefacts only
  rm -f  /mnt/_maint/local/tmp/scd.log                # unbounded scrcpy log
sync && fstrim /mnt/_maint                            # punches holes in the image
umount /mnt/_maint && losetup -d /dev/loopN
```

`debug_ramdisk/` (serial, `android_id`, model, SIM, timezone) and
`/data/data/<pkg>/` (app sessions) are never opened. Only crash dumps and logs
are deleted; everything else the pass reclaims was already free inside the guest.

**Skip anything whose docker state is not `exited`.** A container mid-boot or
serving an operator must not have its filesystem repaired under it.

> **`docker stop` does not stop a container.** VMOS supervises them against a
> desired state, so anything you stop on the host comes straight back — measured
> on box-1, nine containers returned within minutes. Always stop through
> `POST /container_api/v1/stop`, which changes the desired state. Note it also
> refuses a batch containing any instance that is not `running`, so stop stuck
> devices one at a time rather than as a list.

### Result, 31 August 2026

| | before | after |
|---|---|---|
| `/container_nswc_lv` | 436 GB used, 98% | 305 GB used, 69% |
| free space | 9 GB | 141 GB |
| ext4 error flags | 44 | 1 |

Validated on two canaries with `model_backup` taken first: the treated device
booted in 23 s against 22 s for an untouched control, with serial, `android_id`,
model, timezone and ADBKeyboard all intact. A container with 13 historical
`ROM not ready` failures booted again in 45 s.

### Prevention

`check-drift.mjs` now fails on disk occupancy, warning at 75% and critical at
85% (`host_disk` in [`fleet-reference.json`](fleet-reference.json)). Nothing
watched this before, which is how a box reached 98%. box-1's SSD was back at
**80 %** on 25 September 2026 (352/469 GB): the pass is due again there.

### The eMMC root — what fills 26 GB

Measured on 25 September 2026, before the hygiene layer landed: journald 2.5 GB
per box (no `SystemMaxUse`), rsyslog duplicating it into `/var/log` with **no
logrotate installed** (3–3.8 GB per box), and the per-container proxy engine
logs. `cbs_go` runs one host-side `mihomo` per running container and writes its
config with `"log-level": "debug"`: two-thirds of the lines are `[Rule]` /
`[Sniffer]` debug, the rest one `info` line per connection, and every QUIC
attempt from TikTok is `REJECT`ed by rule and logged — 1.46 GB for a single
device, 3.4 GB on box-1. `proxy_set` has no log-level parameter, so the fix is
host-side: `journald.conf.d/attila.conf` (300 MB), `logrotate.d/rsyslog`
(50 MB × 3), `logrotate.d/attila-mihomo` (20 MB, copytruncate), plus
`GET /v1/prune_images` for Android images no container uses (5.9 GB on box-1,
3.3 GB on box-2 that evening). Root went 77 % → 38 % on box-1 without touching
a device.

Two more things measured that evening, both explained:

- **`vm.swappiness` at 100 on box-1** while the firmware's `zram-init.service`
  sets 10 at boot. Every Android guest's `init.rc` runs
  `write /proc/sys/vm/swappiness 100`, the containers are privileged, and on
  the 5.10 kernel the write reaches the host — 10 with no container, 100 as
  soon as one runs. On the 6.1 kernel (box-2, same test) it stays in the guest.
  `attila-sysctl.timer` re-asserts 10 every minute until box-1 is on 2.0.57.
- **`/interface_logs/stats` is not empty on CBS 1.1.6.12.1** (5 categories,
  381 k adb calls with a 100 % success rate); `/recent` returns 20 rows with a
  method label and a status, no path.

## 2. Device inventory and provisioning

Three facts about a device matter before it can serve a job, and none of them
follow from VMOS reporting `state: running`.

**Does the container exist?** DB rows outlive deleted containers. 48 ghosts were
found on 31 August 2026, 43 of them on box-5.

```bash
node scripts/reconcile-devices.mjs --dry-run   # then without the flag
```

**Is the software there?** Read it offline, straight off each stopped
container's `data.img` — 451 devices inventoried without booting one:

```bash
node scripts/audit-device-packages.mjs
```

This fills `adbkeyboard_installed`, `tiktok_installed`, `twitter_installed`.
Prefer it to the online audit, which can only see running devices and therefore
left a whole box's columns NULL — read downstream as "nothing installed", which
was wrong.

**Does it actually boot?** `state: running` says a container process exists, not
that Android came up:

```bash
node scripts/audit-device-health.mjs --box box-1.attila.army
node scripts/audit-device-health.mjs --box box-1.attila.army --recheck --concurrency 1
```

Boots in batches within the 10-per-box ceiling, skips devices with a job due,
and records `healthy` / `unstable` (booted then crashed) / `dead`.

> **Concurrency contaminates the verdict.** Boots contend for the same host: on
> box-1 the median healthy boot was **24 s serially against 93 s at concurrency
> 9**, so healthy devices overran the 120 s ceiling and were called dead. The
> first sweep produced **56 dead of 96; a serial re-probe cleared 38 of them**.
> The script now re-probes every non-healthy device serially before persisting,
> and `--recheck` re-runs only the ones a previous pass could not clear. Never
> report a device dead on a concurrent pass alone.
>
> Note the sweep can only stop what it started, and a genuinely dead container
> sits in `starting`, which `POST /container_api/v1/stop` refuses. Those are
> left running and skipped by the next `--recheck` as "already running" — stop
> them individually first.

### The `starting` deadlock — real, but it does clear

A container whose Android never signals boot completion sits in VMOS state
`starting`, and while it does, every lifecycle endpoint gates on `running`:

| attempt | result |
|---|---|
| `POST /container_api/v1/stop` | `Some instances are not in the 'running' state` |
| `POST /container_api/v1/reboot` | same |
| `recreate_container`, `update_stopped_image` | require `stopped`/`failed` |
| `docker stop` / `docker kill` on the host | **cbs_go restarts it within ~40 s** |

Measured: killed at the docker level, 0 running for ~15 s, back to 5 running at
t+40 s. The supervisor enforces its desired state regardless of docker's restart
policy (which is `no` on these containers).

The cost is not theoretical. Six such containers on box-1 held the host at
**100% CPU with a load average of 19** while doing nothing — starving the
healthy devices beside them.

**But `starting` is a phase, not a terminal state.** Retried over a minute it
never budged, and it looked permanent; several hours later the same containers
had moved to `running` and `POST /container_api/v1/stop` took them down on the
first try, box-1 going to a clean 96/96 stopped. So:

- **Do not reach for `reset` or `delete`.** They are the only endpoints that
  might accept a `starting` instance and both destroy the device's data —
  every one of these six carried an avatar and four had job history.
  `model_backup` is no safety net either; it also requires `stopped`/`exited`.
- **Poll `stop` on a long horizon instead** — minutes are not enough, hours are.
  A patient retry loop clears the state without losing anything. Since 25
  September 2026 production does this by itself: the reconcile marks a
  `starting` container `running` in the database, the reaper (15-minute idle
  window, `stopContainer` ignores the `code 2` refusal) tries to stop it and
  flips the row to `stopped`, the next reconcile flips it back — an 18-minute
  cycle that takes the container down on the first pass after it reaches
  `running`. No operator action is needed; the cost is the host load meanwhile.
- **Do not boot a device recorded `dead`.** That is how the six of 26
  September were created (a full sweep re-probed them): `audit-device-health.mjs`
  now skips known-dead devices unless `--recheck`.
- Meanwhile the host pays for it, so a box carrying several of these is worth
  watching: the containers are not idle, they are looping on a boot that never
  completes.

Worth raising with VMOS all the same: nothing in the API surfaces "this instance
has been trying to boot for six hours", and no endpoint interrupts it on demand.

Then fill the gaps, targeting only what needs it:

```bash
node scripts/install-adbkeyboard.mjs --missing-only --box box-3.attila.army
```

## 3. Screen projection (scrcpy)

`/var/lib/scd/scd.sh` starts scrcpy 3.3.3 with fixed defaults and appends the
guest's `/data/local/scd.conf`:

```sh
ARGS="$DEFAULT_ARGS $(cat "$CONF_FILE")"
```

So tuning is per device, survives restarts, and is undone by deleting the file.
The defaults set no bit rate, no `max_fps` and no key-frame interval, and leave
`log_level=verbose` writing to an unbounded `/data/local/tmp/scd.log`.

Two scripts write that file; they share `scripts/lib/scrcpy.mjs` so they can
never disagree about what it says.

```bash
# Offline — the whole fleet, nothing booted. ~2 min for 450 devices.
node scripts/tune-scrcpy-offline.mjs --dry-run
node scripts/tune-scrcpy-offline.mjs

# Online — the containers that are already up, which the offline pass skips.
node scripts/tune-scrcpy.mjs --box box-5.attila.army
node scripts/tune-scrcpy.mjs --box box-5.attila.army --revert
```

The offline pass writes straight into the guest's data partition with
`debugfs`: `data.img` **is** the guest's `/data`, so `/local/scd.conf` in the
image is `/data/local/scd.conf` to Android. It costs no boots, where the online
pass costs one per device and is capped at 10 running containers per box.

> **The one rule.** ext4 must never be written underneath a mounted
> filesystem. Every image is checked for a mount entry and a loop device on the
> box before it is touched. This is not theoretical: on the first fleet-wide
> run, one container that VMOS reported as `stopped` still had its image held
> by a loop device, and the guard skipped it. Re-run later to catch those.

The key setting is `video_codec_options=i-frame-interval=1`: one key frame per
second, so a reconnect paints within a second instead of waiting out a long GOP.
`log_level=info` is the other one that matters — the conf is appended *after*
the defaults and the last value wins, so it overrides the stock
`log_level=verbose` that filled box-1's disk.

### Reloading the projection service

`scd` is an Android **init service** (a oneshot that spawns the daemon), so init
restarts it:

```sh
setprop ctl.restart scd
```

Measured on box-5: a new scrcpy process and a passing `/stream-ready` handshake
**two seconds** later, against 30-90 s for a container restart plus a full
Android boot. This is what makes `projection_dead` cheap to recover from, and
it is what `POST /api/devices/{id}/stream/reload` does.

Note this is *not* the Container API's `/refreshScreenService`, whose name
suggests otherwise: that one uploads a replacement scd binary.

Killing the scrcpy process is also safe — the box supervises it and brings it
back within a few seconds — but `ctl.restart` is deterministic and three times
faster, so nothing needs to kill anything.

## 4. Diagnosing a stream that will not start

`GET /stream-ready/{db_id}` (magicbox-proxy ≥ 1.2.0) completes a real WebSocket
handshake against the scrcpy port and separately asks the in-guest v2 agent, so
it reports which remedy applies:

| `reason` | meaning | remedy |
|---|---|---|
| `ready` | both alive | — |
| `projection_dead` | Android answers, scrcpy does not | reload the projection service |
| `android_down` | neither answers, container listed | restart the container |
| `not_listed` | no container or no port yet | stopped, or still booting |
| `resolve_failed` | the VMOS API itself is unreachable | check the box |

Before 1.2.0 this endpoint only opened a TCP connection. The host-side port
forward stays bound after the in-container scrcpy dies, so a dead stack answered
`{ ready: true }` and the client then took a 502 — the "zombie" devices whose
only known remedy was restarting the whole container.

## 5. Vendor layer (CBS and kernel)

Upgradable through the official API, contrary to what this repo used to claim:

- `POST /v1/update_cbs` — multipart, file named `cbs_go_edge_<version>`
- `POST /v1/update_kernel` — multipart `.img`; **the host reboots afterwards**

**Always read `model` from `GET /v1/get_hardware_cfg` first.** The fleet mixes
`L1` (box-1..4) and `E1.01` (box-5) hosts. That endpoint is also the only
reliable source of the CBS version — `/v1/systeminfo` returns it blank on the
1.1.4.x line, which is why three boxes read as "unknown" for months.

### The L1 targets and box-1's kernel (state on 25 September 2026)

All four boxes are the same board (`Rockchip RK3588S MARSBOX`, model `L1`). The
vendor's last releases **for L1** — every later one is L20-only, then K30-only
— are pinned in `fleet-reference.json`: kernel `boot-2.0.57-marsbox.img`
(61 MB, 5 June 2026) and CBS `1.1.7.17.1` (211 MB, 17 July 2026, "fixed cloud
devices getting stuck during startup"), fallback CBS `1.1.7.2.1` (embedded in
the last L1 firmware `update_2.0.61_marsbox_20260703.img`). The vendor's note
of 5 June: **CBS ≥ 1.1.6.5 requires kernel ≥ 2.0.57**.

box-1 violates it: CBS `1.1.6.12.1` (taken on 23 June — `cbs_go.pre-upgrade`
under `/root/upgrades` is the 1.1.4.x binary it ran before) on kernel
`1.0.86_marsbox`, Linux **5.10.157**, firmware E1.02 of November 2025, no
`overlayroot`. box-2/3/4 run CBS `1.1.4.30.1` on kernel `2.0.30_marsbox`,
Linux **6.1.158**, with `overlayroot`. Two measured consequences of box-1's
kernel so far: the guest `swappiness` write leaking to the host (above), and
the ext4 corruption episode under disk pressure in June (correlation, not
proof).

The upgrade path is the API (`POST /v1/update_kernel`, host reboots ~3 min;
`POST /v1/update_cbs`), **one box at a time, box-2 as canary**, and it is
**one-way**: no kernel-only image exists to return to 2.0.30, the only way back
is a full firmware flash that erases the SSD. For box-1 a written vendor
confirmation that the kernel-only jump from 1.0.86 / E1.02 without overlayroot
is supported comes first. Full procedure and gates: `fleet-reference.json →
vendor_upgrade_path` and the September 2026 plan.

Pre-flight measured on 25 September 2026, on both CBS lines (1.1.4.30.1 on
box-2, 1.1.6.12.1 on box-1), REST on the box itself:

- **`/disk_migration/v1/status` → `404 page not found` on both lines.** The
  vendor's documented safety net for a flash does not exist on our firmware;
  the plan's "`disk_migration/prepare` before each flash" cannot be done. What
  protects the data is that `update_kernel` and `update_cbs` do not touch the
  NVMe (containers live under `/container_nswc_lv`) — the full firmware image
  is the only operation that erases it, and it is not part of the path.
- `/backup/export` exists on both lines (called without `db_id` it answers
  `code 400, param db_id` — the per-container export, the per-device fallback
  if a box has to be re-imaged one day); `/backup/list` answers `backups: []`
  on both: nothing has ever been exported.
- `/v1/swap_size/{gb}` is in the box's MCP catalogue and is **mutating** (it
  resizes the swap file); deliberately not probed — `/v1/swap_size` without
  a size is a 404, which says nothing about the sized route.
- The rollback of a CBS step is the binary the updater leaves behind
  (`/root/armcloud-container-backend-service/cbs_go.backup`, restarted through
  `supervisorctl restart cbs_go`); the kernel step has none.
- The artifacts were downloaded and hashed that evening (sizes equal to the
  vendor's declared ones): `boot-2.0.57-marsbox.img` 61 023 232 B sha256
  `5bb83814…95ce`; `cbs_go_edge_1.1.7.17.1.cbs` 211 228 000 B sha256
  `e4298435…3d94`; `cbs_go_edge_1.1.7.2.1.cbs` 211 039 680 B sha256
  `580cac03…156b`. The vendor publishes no checksums; these are ours.

Done on box-2, box-3, box-4 on 26 September 2026 (FLEET-ALIGNMENT.md, Phase 2
snapshot). The procedure that worked, ~12 minutes per box:

```bash
# 1. freeze: maintenance window (admin UI, 2 h) — 0 running, 0 job/task due
# 2. keep our own copy of the running binary
ssh root@<box> 'cd /root/armcloud-container-backend-service && cp -p cbs_go cbs_go.<current-version>'
# 3. kernel — the host reboots by itself; find it again BY MAC, its lease may change
curl -F "file=@boot-2.0.57-marsbox.img" http://<box-ip>:18182/v1/update_kernel
# 4. cbs — cbs_go restarts in ~25 s and leaves cbs_go.backup = the previous binary
curl -F "file=@cbs_go_edge_1.1.7.17.1.cbs" http://<box-ip>:18182/v1/update_cbs
# 5. verify: get_hardware_cfg (version, kernel_version), list_names unchanged,
#    two serial boots (boot_ms, /stream-ready, v2 base/version_info, /proxy-test),
#    close the window, check-drift
```

CBS rollback: `cp cbs_go.backup cbs_go && supervisorctl restart cbs_go`.
Kernel rollback: none.

### The question to send to VMOS before touching box-1

To `start@vmoscloud.com` (English, one message):

> We operate VMOS Edge boxes, hardware model **L1** (Rockchip RK3588S,
> MARSBOX). Three of them were upgraded today through the API to kernel
> `boot-2.0.57-marsbox.img` and CBS `1.1.7.17.1` without issue. The fourth
> box differs: it runs firmware **E1.02 (November 2025)**, kernel
> **1.0.86_marsbox (Linux 5.10.157)**, **without overlayroot**, and CBS
> **1.1.6.12.1** — a combination your 5 June release note says is not
> supported (CBS ≥ 1.1.6.5 requires kernel ≥ 2.0.57). Questions:
> 1. Is `POST /v1/update_kernel` with `boot-2.0.57-marsbox.img` supported
>    from 1.0.86 / E1.02 on a root filesystem without overlayroot, or does
>    this box require the full firmware image
>    (`update_2.0.61_marsbox_20260703.img`)?
> 2. Does the full firmware flash erase the NVMe (`/container_nswc_lv`,
>    96 containers) or only the eMMC?
> 3. Is there a kernel-only image to return to 1.0.86 if the 2.0.57 kernel
>    fails to boot on this firmware?
> Device id `6d9d218d5e9f81e8`, MAC `70:b3:d5:1a:75:c9`.

## 6 bis. Concurrency, the 10-container ceiling and the v2 agent — measured 9 September 2026

Full record in `../../MAINTENANCE-AGENT.md` §2.5.

- **The API does not enforce the ceiling.** With 10 containers running on
  box-3, `POST /container_api/v1/run` accepted an 11th (state `starting`). It
  stayed unstoppable until it reached `running` a minute later. The limit of
  10 — and any lower operational limit — is ours to enforce in the scheduler.
- **Boot times under contention (box-3, 16 GB):** serial 10–17 s; six
  simultaneous starts 35–82 s; four more on top 69–89 s; at 10 running, CPU
  100 % and RAM 12.1/15.9 GB. Consistent with the 24 s vs 93 s figures above.
  Start at most two containers at a time per box.
- **v2 agent route after a restart.** When a container restarts with a new
  Docker IP the host may keep routing `/android_api/v2/{db_id}/…` to the old
  one (`dial tcp 172.17.0.2:18185: no route to host` while the guest is on
  `.3`) for minutes. The v1 shell and `curl http://127.0.0.1:18185/api/…`
  from inside the guest work throughout. Probe `base/version_info` with
  retries after every start; never assume v2 is up because Android is.
- **Reconciliation drift seen the same day:** box-4 answered on its tunnel
  with 18.8 h uptime while `boxes.status` said `offline`; one container ran on
  box-2 with `devices.state = 'stopped'`. The reaper cannot see either.

## 6. Proxy hygiene

```bash
node scripts/audit-proxies.mjs --running-only --geo
```

`/proxy-test/{db_id}` is the real routing verdict (a mihomo delay measurement
through the upstream); the `healthy` flag returned by `proxy_get` only reflects
what was configured. mihomo runs inside the container, so a stopped device
reports `engine_unreachable` — expected, not a dead proxy.

`--geo` additionally asks the DEVICE for its own public IP and compares the
country against the avatar's. Do **not** use `/android_api/v1/ip_geo/{db_id}`
for this: it geolocates the configured proxy hostname — `disp.oxylabs.io`
resolves to the dispatcher in Falkenstein — rather than the session's egress.
Only a request made from inside the guest traverses the proxy.
