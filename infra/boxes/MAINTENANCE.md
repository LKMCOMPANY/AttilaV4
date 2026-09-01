# Box maintenance runbook

Operational procedures for the VMOS Edge hosts. Read
[`README.md`](README.md) first for the deploy/drift model, and
[`FLEET-ALIGNMENT.md`](FLEET-ALIGNMENT.md) for version policy.

Everything here is reachable over the Cloudflare tunnel: HTTP on
`https://box-N.attila.army` with the CF Access service token, SSH on
`root@ssh-box-N.attila.army` through a `cloudflared access ssh` ProxyCommand.
There is no LAN path — the boxes' `192.168.1.x` addresses belong to their own
remote network and merely happen to overlap with ours.

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
watched this before, which is how a box reached 98%.

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
  A patient retry loop clears the state without losing anything.
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

### Open item: box-1's kernel

All boxes are the same board (`Rockchip RK3588S MARSBOX`), but box-1 runs Linux
**5.10.157** where box-2 runs **6.1.158** — different LTS lines, not just
different builds. Its `cbs_go.backup` shows it took the June CBS upgrade to
1.1.6.x while box-2/3/4 stayed on 1.1.4.x, yet its kernel was never moved with
it. A half-completed migration, on precisely the box that then suffered ext4
corruption under disk pressure.

The correlation is suggestive, not proven. Acting on it needs the vendor's
kernel `.img` — no kernel image is retained on any box — and a maintenance
window, since `update_kernel` reboots the host. **Not actionable without VMOS.**

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
