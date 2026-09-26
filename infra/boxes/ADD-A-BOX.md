# Adding a box — the runbook

One box, from the carton to "its devices take jobs", in the order the pieces
depend on each other. Everything here is either a tool of this repo (run it,
read its exit code) or a fact measured on the fleet; the one step never played
in a session — the Cloudflare side of a *new* tunnel, § 2 — is marked
**[unverified]**: play it on the next real box and strike the mark.

Read first: [`README.md`](README.md) (what a box runs and what `deploy.sh`
converges), the hard rules in [`../../AGENTS.md`](../../AGENTS.md) § "boxes and
their network". Two of them shape every step below: **no IP address in any
config, ever** (a box is `device_id` + MAC, its address is discovered), and
**canary first, one box at a time**.

Budget for a box of 100 containers: about half a day of wall clock, most of it
the device layer (boots), almost none of it typing.

## 0. Before it is plugged in

| Have | Where |
|---|---|
| The box number `N` (next free in `manifest.tsv`) | `manifest.tsv` |
| `infra/boxes/.env` filled: `BOX_SSH_PASSWORD` (vendor root password, bootstrap only), `CF_ACCESS_CLIENT_ID/SECRET`, optional `CLOUDFLARE_API_TOKEN` | `.env.example` |
| The fleet key loaded: `ssh-add --apple-use-keychain ~/.ssh/id_ed25519_attila` | — |
| `cloudflared` on your Mac, logged in once (`cloudflared tunnel login`) | Cloudflare account of `attila.army` |
| The proxy list for its devices' countries (`country,host,port,username,password[,city]`) | operator |

Plug the box on the **office LAN, DHCP** — never a static lease, never an IP
typed anywhere. cbs_go takes a lease at boot and pins it into NetworkManager;
that is the vendor's job and it does it.

## 1. Identity — read, never assume

Find it on the LAN and read its hardware facts (the same call every tool uses
to trust a LAN candidate):

```bash
# from infra/boxes/ — a 2 s sweep of the local /24 for :18182 answers, then the ARP table
bash -c 'source scripts/lib/transport.sh && lan_sweep && arp -a' | grep -i "<mac on the label>"
curl -s http://<candidate>:18182/v1/get_hardware_cfg | jq '.data | {model, device_id, hwaddr, kernel_version, cbs: .version}'
```

(`data.version` is the CBS version — the only reliable place for it;
`/v1/systeminfo` leaves it blank on the 1.1.4.x line.)

- **`model` decides everything vendor-side.** `L1` is box-1..4; box-5 is K1
  hardware whose API says `E1.01`. They do not share a kernel. A model absent
  from `fleet-reference.json → vendor` is an *unknown host model* — `check-drift`
  fails on it by design. Add the model's baseline (kernel + CBS versions and
  URLs, read from the vendor's `ai-reference-container.txt`) **before**
  anything else, as its own commit; never push another model's firmware.
- Keep `device_id` and `hwaddr` for the manifest row, written once step 2 has
  produced the tunnel id: `N<TAB>tunnel_id<TAB>device_id<TAB>hwaddr` (MAC
  lower-case). Empty `device_id`/`hwaddr` means "no LAN discovery, tunnel
  only" — a temporary state, not a way to skip this step.

## 2. Cloudflare — the tunnel and its two names **[unverified]**

The five existing tunnels predate the IaC; this is how the sixth is made so
that `check-drift.mjs` reads it as aligned (tunnel named `box-N`, healthy; two
**proxied** CNAMEs to `<tunnel_id>.cfargotunnel.com`; **no remote-managed
config** — the box's `/etc/cloudflared/config.yml` rendered by `deploy.sh` is
the only source of truth).

```bash
cloudflared tunnel create box-N                      # prints the UUID, writes ~/.cloudflared/<uuid>.json
cloudflared tunnel route dns box-N box-N.attila.army
cloudflared tunnel route dns box-N ssh-box-N.attila.army
```

- The credentials JSON is a **secret and stays off the repo**: copy it to the
  box as `/etc/cloudflared/<uuid>.json`, mode `0600`, root (over the LAN:
  `scp ~/.cloudflared/<uuid>.json root@<lan-ip>:/etc/cloudflared/`; the LAN
  address is used *once, on the command line, never written*). `deploy.sh`
  renders `credentials-file: /etc/cloudflared/<uuid>.json` from the manifest —
  the name must match.
- Access: one application covers `*.attila.army` with the "MagicBox SSH"
  service-token policy (`ARCHITECTURE.md` § Tunnel Cloudflare). Confirm in Zero
  Trust that both new hostnames fall under it; if the application enumerates
  hostnames instead, add the two. The deploy's external `/healthz` check is
  what proves it.
- Do **not** configure the tunnel in the dashboard ("remote-managed"): the
  checker flags that as a second source of truth and fails.
- Now write the manifest row (step 1) with this tunnel id, and commit it: the
  manifest is what `deploy.sh` renders the box's config from.

## 3. Converge the host — `deploy.sh`

```bash
./scripts/deploy.sh N                # LAN found by MAC + device_id, password auth this once
```

`deploy.sh` installs Node 24 and cloudflared at the pinned versions, the proxy,
the managed files, the hostname `box-N`, timezone, locale, `logrotate`, the
fleet key, then restarts the services and waits for `https://box-N.attila.army/healthz`
to answer 200 through the tunnel — **that line is the proof that steps 2 and 3
agree**, and the only one available before step 4: `check-drift.mjs` walks
the boxes the *database* knows, so a box that is only in the manifest is not
in its report yet. It is idempotent; re-run it until the healthcheck prints
`200` and `api_source: default_route`. Once the key is in, `BOX_SSH_PASSWORD`
is unused; `--lock-root-password N` is **gated** (needs a key-authenticated
run, and your decision).

## 4. The product knows the box — admin "Create box"

Admin › Infrastructure › *Create box*, `tunnel_hostname = box-N.attila.army`
(`createBox` in `src/app/actions/boxes.ts`). It refuses a box whose `/healthz`
does not answer, inserts the **identity row only**, and the presence writer
(`src/lib/boxes/presence.ts`) does the rest on the first observation:
`status`, the *observed* `lan_ip`, uptime, container count, host sample and
verdict, `model` / `cbs_version` / `kernel_version` / `default_image`.
`max_concurrent_containers` stays `null` → the one default, 10
(`DEFAULT_MAX_CONCURRENT`, `box-slots.ts`); `operator_reserve` likewise.

Then *Assign to account* for every client meant to use it (`account_boxes`,
N:N). Devices are imported by *Sync* (`syncBox`) and by the Reconcile worker
every three minutes: every container on the box becomes a `devices` row,
`state` projected from the box, never a gate.

```bash
node scripts/check-drift.mjs         # exit 0 = the box is iso with the fleet, DB included
```

The checker now reads the row; exit 0 is the finish line of the host part.
Expect `inventory drift` until the first Sync has imported the containers, and
nothing else.

## 5. Devices — born aligned, then proven

Containers are created by `MagicBox-Industrial` with
`--image-repository <fleet-reference.json → provisioning.golden_image>` (never
re-typed there — one source), each with its proxy at creation
(`checkProxyIp` gate). Whatever created them, the fleet then proves them with
the same scripts as any other box, **two starts in flight per box**:

```bash
node scripts/audit-device-packages.mjs --box box-N.attila.army                 # offline (debugfs): IME + social apps installed?
node scripts/install-adbkeyboard.mjs --missing-only --box box-N.attila.army    # the IME every job types with — only where the audit found it missing
node scripts/tune-scrcpy-offline.mjs --box box-N.attila.army                   # the one scrcpy conf (checks the image is not mounted)
npx tsx scripts/assign-proxies.ts --csv proxies.csv --box box-N.attila.army --dry-run
npx tsx scripts/assign-proxies.ts --csv proxies.csv --box box-N.attila.army --report out.json
node scripts/audit-device-health.mjs --with-proxy --box box-N.attila.army --report sweep.json
npx tsx scripts/record-sweep-attention.ts --report sweep.json
```

Read `PROXY-STRATEGY.md` § "The method" before the proxy step: one profile,
one dedicated proxy per device in the persona's country, one holder per proxy
across the whole fleet, proven on the same boot. **A device is job-capable
only with ADBKeyboard and at least one social app** — the sweep's
`job-capable` count, not the container count, is what the box adds to
production. `boot_health` and the package flags are observed, not enforced:
nothing filters on them yet (gated follow-up).

Measurement traps that will bite here, both paid for already: boots contend
(24 s serially, 93 s at concurrency 9 — never call a device dead on a
concurrent pass; the sweep re-probes serially before it does), and VMOS clears
the enabled-IME list on every restart (only the APK *installed* matters at
rest).

## 6. Hand-over

- `check-drift.mjs` exit 0 with `CLOUDFLARE_API_TOKEN` set (tunnel, DNS, host,
  DB, inventory all read).
- A dated snapshot in [`FLEET-ALIGNMENT.md`](FLEET-ALIGNMENT.md): model,
  versions, containers, job-capable count, proxies proven, what was gated.
- Optional: point `.cursor/mcp.json` (gitignored) at it for discovery — the
  tool surface is the same on every box.
- If the box will ever be moved: `node scripts/box-power.mjs N shutdown --yes`,
  never the plug (VMOS restarts at boot every container that was running when
  the power went — box-1: 8 at once, load 192). After a move the lease changes;
  find the box by MAC, nothing to edit. A box up for less than ten minutes
  with more than two containers booting is refused as `box_settling` by the
  slot arbiter — expected, not a fault.

## What is not in this runbook, on purpose

- Vendor firmware upgrades: per model, one-way, canary first, a written vendor
  confirmation for anything but the measured L1 path — `MAINTENANCE.md` § 5.
- Retiring a box: its devices' proxies are dedicated IPs still *held* by their
  accounts; the planner keeps reserving them until the rows say otherwise
  (`--reclaim-offline` is the explicit exception). Decide, then write it down.
