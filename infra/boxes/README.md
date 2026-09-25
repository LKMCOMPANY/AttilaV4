# MagicBox fleet — infrastructure as code

Versioned, identical (iso) configuration for every VMOS box. A box runs:

- **cloudflared** — exposes the box behind a Cloudflare Tunnel with two routes:
  `box-N.attila.army` → the HTTP proxy, and `ssh-box-N.attila.army` → SSH,
  both protected by Cloudflare Access (service-token policy "MagicBox SSH").
- **magicbox-proxy** — the Node reverse proxy (code lives in
  [`../magicbox-proxy`](../magicbox-proxy)) on `127.0.0.1:8080`, Node 24 under
  `/opt/node`.
- the vendor layer we do not own but do pin and upgrade: `cbs_go` (the VMOS
  Container API, supervised by `supervisord`), the kernel, the Android image.

Everything is identical across boxes except the per-box **identity** captured
in [`manifest.tsv`](manifest.tsv): the box number (hostnames), the tunnel id,
the `device_id` and the eth0 MAC. **No IP address lives in this repo or on a
box in a config file.** The boxes are on DHCP (cbs_go takes a lease at boot and
pins it into NetworkManager), a box must be pluggable into another office, and
the proxy resolves cbs_go's address itself from the default-route interface —
the pinned `API_HOST` of earlier versions is what kept box-4 `offline` for four
days when its lease moved (25 September 2026).

## Layout

| Path | Role |
|---|---|
| `manifest.tsv` | Source of truth: box number → tunnel id, device_id, MAC |
| `fleet-reference.json` | Golden targets: vendor baselines per hardware model (CBS/kernel + URLs), runtime pins (Node, cloudflared + sha256), host hygiene, disk thresholds, candidate Android image |
| `templates/cloudflared.config.yml.tmpl` | Rendered per box → `/etc/cloudflared/config.yml` |
| `files/*.service`, `files/*.timer` | iso systemd units → `/etc/systemd/system/` |
| `files/sysctl.d/`, `files/journald.conf.d/`, `files/logrotate.d/`, `files/NetworkManager/`, `files/resolv.conf` | Host hygiene, converged by `deploy.sh` |
| `files/authorized_keys.d/attila-fleet.pub` | The fleet SSH key (public half) |
| `files/sshd_config.d/60-attila.conf` | Key-only root — shipped only by `--lock-root-password` (gated) |
| `scripts/deploy.sh` | Converge a box to this state (idempotent, LAN-first) |
| `scripts/lib/transport.sh` | Env, manifest, LAN discovery, ssh/scp wrappers (bash) |
| `scripts/remote/converge-host.sh` | What runs ON the box, as root, during a deploy |
| `scripts/check-drift.mjs` + `scripts/lib/{env,lan,host,vendor,render}.mjs` | Read-only: report every box's drift vs this repo, the DB and the vendor targets |
| `../../scripts/box-power.mjs` | Move a box: pause, stop containers one by one, `GET /v1/shutdown` |
| `MAINTENANCE.md` | Runbook: disk, inventory, scrcpy, streams, vendor layer, proxies, moving a box |
| `FLEET-ALIGNMENT.md` | Dated snapshots of the fleet and the gated actions |

## Reaching a box: LAN first, tunnel otherwise

Tooling (`deploy.sh`, `check-drift.mjs`, `box-power.mjs`, the device audits)
looks for each box on the **current LAN** first: the ARP table is searched for
the manifest MAC (after a one-second `:18182` sweep of the local /24 so it is
populated), and a candidate is trusted only once `GET /v1/get_hardware_cfg`
returns the manifest `device_id`. Otherwise it rides the Cloudflare tunnel
(`ssh-box-N` through `cloudflared access ssh`, HTTPS with the CF Access
service token) exactly as before. `FORCE_TUNNEL=1` skips the LAN.

The **runtime on Render is tunnel-only** and unchanged. LAN is a tooling
optimisation (an image import is minutes instead of hours) and the reason a
box on the operator's desk can be diagnosed with the tunnel down.

`cbs_go` listens on the LAN address only, never on `127.0.0.1`; the proxy
listens on `127.0.0.1:8080` only, so `/healthz` and `/stream-ready` are
tunnel-only by construction.

## What `deploy.sh` converges (25 September 2026)

One tarball, one SSH connection, then `scripts/remote/converge-host.sh` runs on
the box:

1. **Node 24 LTS** from the official arm64 tarball (sha256 pinned in
   `fleet-reference.json`) under `/opt/node-v24.x`, `/opt/node` symlink; the
   distro Node 20 (EOL) stays untouched and unused.
2. **magicbox-proxy** code + `npm install --omit=dev`.
3. **Managed files**: cloudflared config (rendered), units, `sysctl.d`,
   `journald.conf.d` (300 MB cap), `logrotate.d/rsyslog` (50 MB × 3) and
   `logrotate.d/attila-mihomo` (20 MB copytruncate — the per-container proxy
   engine logs at `debug` level and filled 3.4 GB on box-1), NetworkManager
   `dns=none` + our `resolv.conf` (1.1.1.1, 8.8.8.8 — cbs_go rewrites the
   connection profile's DNS at every boot, so the profile is left to it and
   resolv.conf is taken from it), `attila-sysctl.timer` (re-asserts
   `vm.swappiness=10` every minute: Android guests are privileged and their
   `init.rc` writes 100 through to a 5.10 host).
4. **Removed**: `/etc/magicbox-proxy.env`, any `magicbox-proxy.service.d/`
   drop-in (a pre-IaC `Environment=API_HOST=` survived on box-1 since April),
   the dead `attila-webapp.service` unit.
5. **Identity**: hostname `box-N` (`marsbox` kept as an alias in `/etc/hosts`),
   `Europe/Paris`, `en_US.UTF-8`; `logrotate` installed (the only package we
   add — the OS is vendor firmware, no `apt upgrade`); `apt-get clean`.
6. **Fleet SSH key** appended to `authorized_keys`. Root's password stays
   accepted until `--lock-root-password`, which is refused unless the very run
   authenticated with the key (the private key is passphrase-protected: load
   it with `ssh-add --apple-use-keychain ~/.ssh/id_ed25519_attila` first).
7. **cloudflared** at the pinned version (`.deb`, sha256 verified), restarted
   detached when the deploy itself rides the tunnel.
8. Restart `magicbox-proxy`, external `/healthz`, LAN `/v1/heartbeat`.

```bash
cp .env.example .env            # BOX_SSH_PASSWORD (bootstrap only), CF_ACCESS_* fall back to ../../.env.local
./scripts/deploy.sh 2           # canary first, always
./scripts/deploy.sh 1 3 4       # then the rest, one at a time
./scripts/deploy.sh --proxy-only 3 4      # fast path: only the proxy code
./scripts/deploy.sh --lock-root-password 2   # GATED
```

A proxy or cloudflared restart cuts the box's tunnel for 5–10 s: open streams
drop, in-flight jobs fail with `box_unreachable` and are retried by their
loops. Deploy a box that carries running maintenance sessions in a pause
window (`maintenance.global_enabled` until the per-box mode exists).

## Version drift

```bash
node infra/boxes/scripts/check-drift.mjs            # read-only, exit 0 = our layer is uniform
node infra/boxes/scripts/check-drift.mjs --no-ssh   # API-only (no host facts)
```

Per box it reads the Container API (LAN first), the proxy `/healthz` (tunnel),
the host over SSH in one round trip, the DB row, and — with
`CLOUDFLARE_API_TOKEN` — DNS and tunnel state. It **fails (exit 2)** on what we
control: proxy / Node / cloudflared versions, managed-file digests, hostname /
timezone / locale / resolvers / swappiness, a pinned IP anywhere, the fleet key,
unused Android images, orphan container directories on the SSD, a stale
`boxes.lan_ip`, DB ↔ box inventory, disk headroom, an unknown host model. A fact
it could not read is shown as `?` and counted as drift (never as a pass) unless
`--no-ssh` was asked for. Vendor firmware and the Android image are
informational and gated (Phase 2 of the September plan).

**Vendor baselines are per hardware model.** box-1..4 are `L1`; box-5 is K1
hardware although its API says `E1.01`. They do not share a kernel — pushing
one family's firmware to the other is how you brick a box. Always read `model`
from `GET /v1/get_hardware_cfg` first; it is also the only reliable source of
the CBS version (`/v1/systeminfo` leaves it blank on the 1.1.4.x line).

**Three sources, three levels of trust.** The vendor's online reference
(`help.vmosedge.com/ai-reference-*.txt`) says what exists; a box's MCP
catalogue (`/mcp/sse`, 65 tools, partial — it omits `scd_config`,
`/sys/network/config`, `/backup/*`, `/disk_migration/*`, `/tunnel/*`) says what
the box believes it serves; only a REST probe on the box says what answers on
that CBS line. Count on an endpoint only after probing it.

Secrets are **never** in the repo: the tunnel credentials JSON stays on the
box; the SSH password, the CF Access token and the Cloudflare API token are
read from env / a gitignored `.env` (see `.env.example`).

## One-time bootstrap (a brand-new box)

`deploy.sh` needs either the LAN (box on your network, root password) or
SSH-through-Access, which needs three things in place first: the DNS record
`ssh-box-N.attila.army`, a Cloudflare Access app for it, and the
`ssh://localhost:22` ingress rule in the box's `/etc/cloudflared/config.yml`.
DNS + Access are managed centrally and exist for boxes 1–5. The ingress rule
lives in a **local** file on the box, so a box that never had SSH needs it
added **once**, on the LAN or with console access:

```bash
# on the box, as root — add the SSH route as the FIRST ingress rule:
#   - hostname: ssh-box-N.attila.army
#     service: ssh://localhost:22
systemctl restart cloudflared
```

After that, `deploy.sh` keeps the box fully iso (it ships the exact same
`config.yml`, so the manual edit is superseded by the versioned template). Add
the box's `device_id` and MAC to `manifest.tsv` from `GET /v1/get_hardware_cfg`.
