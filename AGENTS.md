<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Attila V4 — agent onboarding

Read these in order before touching anything in this repo.

## Architecture overview

| File | Read first when… |
|---|---|
| `README.md` | You need the stack, scripts, environment vars |
| `ARCHITECTURE.md` | You're modifying anything cross-cutting (DB, auth, RLS, realtime) |
| `PRODUCT-FLOWS.md` | You don't yet know what this product does |

## Domain modules

| File | Read first when touching… |
|---|---|
| `AUTOMATION-PIPELINE.md` | The pipeline (post → filter → analyst → writer → executor) |
| `X-AUTOMATE.md` | `src/lib/automation/x-reply.ts` or anything Twitter-related |
| `TIKTOK-AUTOMATE.md` | `src/lib/automation/tiktok-reply.ts` or anything TikTok-related |
| `ADB-REFERENCE.md` | Any shell, IME, focus, screenshot, or container helper |
| `GORGONE-INGESTION.md` | The webhook + sweep that feeds posts into the pipeline |
| `LLM-ALERIA.md` | The Aleria LLM provider used for analyst + writer |
| `infra/boxes/README.md` | The fleet IaC: manifest (identity, no IP), LAN-first transport, what `deploy.sh` converges, what `check-drift.mjs` fails on |
| `infra/boxes/ADD-A-BOX.md` | **Adding a box** — identity, tunnel, `deploy.sh`, DB row, devices, hand-over, in dependency order; the Cloudflare side of a new tunnel is marked unverified until played on a real box |
| `infra/boxes/MAINTENANCE.md` | **Anything about a box itself** — moving a box, disk, boot health, device provisioning, scrcpy tuning, stream diagnosis, vendor upgrades, proxy hygiene |
| `infra/boxes/FLEET-ALIGNMENT.md` | Dated fleet snapshots (25 September 2026: Phase 0 and Phase 1) and the gated actions |
| `PROXY-STRATEGY.md` | Proxy assignment, testing, and the exit-IP geo check |
| `VMOS-API-V2-EVALUATION.md` | The Android Control API v2 — measured agent versions, MCP, what to adopt and what not to |
| `MAINTENANCE-AGENT.md` | **Read before touching any automation.** The 9 September 2026 study of avatar maintenance ("opérateur IA"): fleet and account measurements, live tests of the production flows (one false `done` reproduced), the selector-based path validated on X and TikTok, the screen-state taxonomy, decisions, target architecture, roadmap. Nothing in it is implemented yet. |

## What a device actually is

The single most expensive assumption in this codebase is that a device VMOS
reports as `running` can do work. It cannot, necessarily. Three independent
things have to be true, and each has its own column and its own audit script:

| Question | Column | Script |
|---|---|---|
| Does the container still exist? | `devices.state <> 'removed'` | `scripts/reconcile-devices.mjs` |
| Does Android actually boot? | `boot_health`, `boot_ms` | `scripts/audit-device-health.mjs` |
| Is the software there? | `adbkeyboard_installed`, `tiktok_installed`, `twitter_installed` | `scripts/audit-device-packages.mjs` |

**A device is job-capable only with ADBKeyboard AND at least one social app.**
On 31 August 2026 that was 150 of 452 — that number, not the container count,
is what bounds production. `check-drift.mjs` reports it per box.

These columns are **observed by the audits and enforced by one rule** (since
26 September 2026): `deviceIncapability()` in `src/lib/devices/job-capability.ts`
answers `boot_dead` / `ime_missing` / `app_missing` / `null`, and the three
places that hand a device work apply it — the campaign selector
(`avatar-selector.ts`, counted as `unfit`), the maintenance planner
(`planner.ts`, `skipped.unfitDevice`) and the directed-action route
(`directed-actions.ts`, reason `unfit_device`). Two silences are deliberate:
`null` columns mean "never audited", not "missing" (the audits write `false`
when they look and find nothing), and a boot verdict counts only while it is
`dead` *and* recent — the same `actionableBootHealth()` rule (14 days) the
roster and the inspector use to show the verdict in place of the state dot on
both clients. Don't add a second rule; a badge that cries wolf gets ignored,
and the next dead device with it.

Two measurement traps, both paid for the hard way:

- **Concurrency contaminates a boot verdict.** Boots contend for the host: the
  median healthy boot was 24 s serially against 93 s at concurrency 9, so
  healthy devices overran the 120 s ceiling and read as dead. A first sweep
  called 56 of 96 devices dead; a serial re-probe cleared 50 of them. Never
  report a device dead on a concurrent pass alone.
- **ADBKeyboard missing from `enabled_input_methods` after a boot is normal.**
  VMOS clears the enabled-IME list on every container restart, and
  `activateAdbKeyboard()` re-does `pm enable` + `ime enable` + `ime set` on
  every job. Only the APK being *installed* matters at rest.

## Hard rules — boxes and their network (25 September 2026)

1. **No IP address in any config, ever.** The boxes are on DHCP (cbs_go takes
 the lease at boot and pins it) and must be pluggable into another office. A
 box's identity is `device_id` + MAC (`infra/boxes/manifest.tsv`); its address
 is *discovered* (LAN: ARP + `GET /v1/get_hardware_cfg`) or irrelevant
 (tunnel). `magicbox-proxy` ≥ 1.3.0 resolves cbs_go's address from the
 default-route interface and re-resolves on `EHOSTUNREACH`; `boxes.lan_ip` is
 observed from `/v1/net_info`, never typed. A pinned `API_HOST` is what kept
 box-4 `offline` for four days.
2. **LAN first, tunnel as fallback — for tooling only.** `deploy.sh`,
 `check-drift.mjs`, `box-power.mjs` and the audits find the box on the current
 LAN before riding the tunnel. The Render runtime is tunnel-only; never make
 product code depend on a LAN path.
3. **Three sources, three levels of trust.** The vendor's online reference
 (`help.vmosedge.com/ai-reference-container.txt`, `-control.txt`) says what
 exists; a box's MCP catalogue (`/mcp/sse`, 65 tools, partial — no
 `scd_config`, `/sys/network/config`, `/backup/*`, `/disk_migration/*`,
 `/tunnel/*`) says what the box believes it serves; only a REST probe on the
 box says what answers on that CBS line. Count on an endpoint only after
 probing it on the box that will run it.
4. **Never unplug a box without `node scripts/box-power.mjs <box> shutdown`.**
 VMOS restarts at boot every container that was running when the power went
 (box-1: 8 containers at once, load 192). The script pauses maintenance, stops
 containers one by one, waits for 0 running, then `GET /v1/shutdown`.
5. **Vendor firmware is per hardware model and one-way.** L1 (box-1..4) and
 K1 (box-5, API `model` says `E1.01`) do not share a kernel; no kernel-only
 image exists to go back to 2.0.30. Read `model` first, canary box-2 first,
 one box at a time under a maintenance window, and a written vendor
 confirmation before touching box-1 (5.10 → 6.1, no overlayroot). There is
 no vendor safety net: `/disk_migration/*` is 404 on every CBS line we run;
 what protects the data is that `update_kernel` / `update_cbs` touch neither
 the NVMe nor the overlay upper (measured on box-2/3/4, 26 September 2026 —
 kernel 2.0.57 + CBS 1.1.7.17.1, ~12 min per box). A kernel flash can change
 the DHCP lease: find the box by MAC afterwards, never by its old IP.
6. **The host is vendor firmware; our layer is `infra/boxes/`.** No `apt
 upgrade`; `logrotate` is the only package we add. Everything we converge is a
 versioned file under `infra/boxes/files/` shipped by `deploy.sh` and verified
 by `check-drift.mjs` (exit 0 = uniform). Hand edits on a box are drift. sshd
 listens on IPv4 only (`sshd_config.d/50-attila-inet.conf`): the boxes hold a
 global IPv6 address with no NAT in front of it, and nothing of ours reaches a
 box over IPv6.
7. **One boot per device per sweep.** `scripts/audit-device-health.mjs
 --with-proxy` answers boot health, the configured proxy (mirrored to
 `devices.proxy_*`), routing and exit geo on the same boot; the per-device
 probes have one definition, `scripts/lib/proxy-probe.mjs` (verdicts in
 `proxy-verdict.mjs`, tested against the proxy's fixture), shared with the
 read-only `audit-proxies.mjs`; the former `audit-proxy-fleet.mjs` is gone,
 the sweep does its job. Two starts in flight per box
 is the default; `scripts/lib/fleet.mjs` and `box-ssh.mjs` reach the box on
 the LAN first (352 devices' packages audited in 126 s). Don't add a fourth
 boot-everything script.
8. **Host health has one rule and the cockpits never compare gauges.**
 `assessHostHealth()` (`src/lib/boxes/host-health.ts`) reads a sample against
 `runtime_settings.boxes.health_thresholds`; the slot arbiter refuses
 `box_unhealthy` with it and the presence writer stamps its `verdict` and
 `over` on `boxes.host_health`. Web and Mac show `verdict` through the shared
 vocabulary (`src/lib/presentation/box-health.ts` ↔
 `BoxHealthPresentation.swift`, pinned to `__fixtures__/box-health-vocabulary.json`).
9. **A refused start is never shown running.** `POST /api/devices/{id}/start`
 answers `{ refused, refusedDetail }` for the arbiter's hard refusals
 (`box_maintenance`, `box_unhealthy`, `box_settling`, `box_unreachable`,
 `starts_in_flight`); both cockpits revert the optimistic state and name the
 reason through `src/lib/presentation/slot-refusal.ts` ↔
 `SlotRefusalPresentation.swift` (`slot-refusal-vocabulary.json`). Before 25
 September 2026 both clients read that answer as success.
10. **The proxy's wire contracts are fixtures, replayed on three sides.**
 `infra/magicbox-proxy/test/fixtures/{healthz,stream-ready}.json` are asserted
 by the proxy's contract test, by `presence.test.ts` / `stream-readiness.test.ts`
 (web) and by `StreamReadinessTests.swift` (Mac). A new `/healthz` field or
 `/stream-ready` reason is a change to the fixture first.

## Hard rules — screen projection

1. **A dead projection does not need a container restart.** `scd` is an Android
   init service, so `setprop ctl.restart scd` brings it back — measured at two
   seconds against 30-90 s for a restart plus a full boot, and the operator's
   session survives. That is what `projection_dead` from `/stream-ready` means
   and what `POST /api/devices/{id}/stream/reload` does. Restarting the
   container is the fallback, for when Android itself is gone.
2. **`/refreshScreenService` on the Container API is not that.** Despite the
   name it uploads a replacement scd binary. Don't reach for it to restart
   anything.
3. **Never write a guest `data.img` that is mounted.** The offline scripts
   (`audit-device-packages.mjs`, `tune-scrcpy-offline.mjs`) reach into stopped
   containers with `debugfs`, which is what makes fleet-wide work cost minutes
   instead of hours. Both check `/proc/mounts` *and* `losetup -j` on the box
   before touching an image, because VMOS reporting `stopped` is not proof the
   loop device was released — observed in the wild on the first fleet run.
4. **The scrcpy conf has one definition**, `scripts/lib/scrcpy.mjs`. The online
   and offline writers differ in delivery only, never in content.

## Hard rules — automation code

These come from a refactor on 18 April 2026 that fixed a class of bugs
where jobs were marked `done` while nothing was actually posted. Do not
regress on them:

1. **Never assume `status="running"` from VMOS means Android is ready.**
   Always go through `ensureContainerReady()` (polls `getprop sys.boot_completed=1`).
2. **Never silently ignore `shell()` failures.** The helper throws
   `ContainerNotReadyError` on VMOS code 201. Let it propagate; the
   pipeline executor and route handler turn it into a typed `JobError`.
3. **Never use `input text` or `input keyevent` to type into a social
   app.** They are dropped silently by anti-bot protections. Use
   `activateAdbKeyboard()` + `typeText()` (broadcasts via the ADBKeyboard IME).
4. **Always pair `getCurrentIme()` + `restoreIme()` via try/finally.**
   The pipeline `executor` does this for you. CLI scripts do NOT — that's
   intentional (faster iteration during debugging).
5. **Take SOURCE after `waitForFocus`, take PROOF when the composer is
   open with text typed (BEFORE the submit tap).** Don't re-deeplink the
   post just to capture a "proof" — the screenshot endpoint is cached for
   ~5 s server-side and you'll get the cold-start splash.
6. **Verify success from the UI tree with a POSITIVE signal — never
   optimistically, never from a screenshot.** "Cannot verify" = failure.
   Twitter: focus must return to `TweetDetailActivity` (+ optional TikHub
   timeline cross-check, shadow-ban robust). TikTok: our comment must appear
   as a posted item in the list OR the comment count must increment; text
   still stuck in an `EditText`, or an unreadable tree, is a failure. The
   compose phase runs with NO `uiautomator dump` (a dump collapses TikTok's
   composer). See `TIKTOK-AUTOMATE.md` / `X-AUTOMATE.md`.
7. **Always throw a `JobError` with a typed category for known failure
   modes** (`account_logged_out`, `content_unavailable`, etc.). This is
   what the operator sees as a coloured badge in the automator panel —
   don't bury it in a generic `Error`.
8. **Avatar callability is gated by `avatar_platform_blocks` ONLY** (an
   active row = the selector skips the avatar on that platform). Account-level
   failures open a block via `openBlock()` (`src/lib/account-state/blocks.ts`);
   the health worker reconciles TikHub/shadow-ban blocks; operators clear them
   with "Mark resolved" in the Overview panel. Never re-introduce tag-based
   (`blocked_*`) or ad-hoc gating — one table, one gate. What a HUMAN must do
   about it lives in `attention_items` (`src/lib/maintenance/attention.ts`):
   the block gates, the item is worked; an account item points at its block.
9. **Container slots are decided by the live arbiter only**
 (`src/lib/engine/box-slots.ts`): what the box reports (`running` +
 `starting`), the operator reserve, campaign priority over maintenance, at
 most two cold starts in flight per box — and, since 25 September 2026, the
 host itself: `box_maintenance` (an operator opened `boxes.maintenance_until`),
 `box_unhealthy` (CPU / memory / swap above `runtime_settings
 boxes.health_thresholds`), `box_settling` (a box up for less than ten
 minutes with more than two containers booting — the boot storm after a
 move). The operator start route goes through the same arbiter. The
 decision is the pure `decideSlot()`, tested; `SLOT_REFUSALS` is the closed
 vocabulary both cockpits label. `devices.state` is a projection the
 Reconcile worker corrects every three minutes — never a gate.
 **One writer of a box's presence**: `src/lib/boxes/presence.ts`
 (`observeBox` / `markBoxUnreachable`, decision `decidePresence()`) owns
 `boxes.status`, the *observed* `lan_ip`, uptime, container count, the host
 sample and the firmware facts — a box that answers is `online` whatever the
 maintenance window (the window is the arbiter's gate, not a status; only a
 *silent* box keeps its status under a window); `src/lib/boxes/device-inventory.ts` owns
 running / stopped / **removed** / restored. Reconcile, admin Sync, box
 creation and the reaper all call them — never write `boxes.status` or
 `devices.state = removed` anywhere else.
10. **Every real action on a platform is one row of `avatar_actions`**
   (`src/lib/maintenance/ledger.ts`), dated in the device's local day. Daily
   caps are computed against it, never against `campaign_jobs` alone.

## Hard rules — measured on 9 September 2026 (see `MAINTENANCE-AGENT.md`)

These come from live tests of the production flows and of the Control API v2.
They are constraints for any future automation work, including the campaign
flows themselves:

1. **Never trust "focus returned to the activity" as a success signal on X.**
   It produced a `done` while the tweet had never loaded ("Cannot retrieve
   posts at this time"). Success on X = our reply read back as a posted node
   in the tree (or on the avatar's timeline via TikHub), exactly like TikTok.
2. **Never tap a hard-coded coordinate to reach an element that the tree can
   name.** On TikTok 44.8.3 the "comment bar" coordinate hit the Create button.
   Use `accessibility/node` with `xpath contains()` / `@resource-id`; resource
   ids are per app build and belong in a versioned table, not in constants.
3. **Probe before acting.** TikHub account status (1 s) and a `dump_compact`
   classification of the screen before any gesture; a `suspended`, a version
   wall, a bouncer or "Cannot retrieve posts" means no job on that account.
4. **v2 may be unreachable right after `run`** (host routes to a stale Docker
   IP). Probe `base/version_info` with retries; fall back to
   `curl 127.0.0.1:18185` through the v1 shell.
5. **The VMOS API accepts an 11th container.** The 10-per-box ceiling and
   serial boots (two starts at a time, at most) are enforced by our code only.
6. **Selector text is a strict, case- and apostrophe-sensitive equality.**
   Never build a selector from a string produced by a model or by a locale
   without normalising through `contains()`.
7. **Never log a raw `proxy_get` response** — it carries proxy passwords in
   `nodes[]`.

## Hard rules — frontend

1. **Tailwind v4 + shadcn/ui (base-nova).** Don't import unrelated UI libs.
2. **Server components by default.** Reach for `"use client"` only when you
   need state, effects, or browser-only APIs.
3. **No setState inside an effect** unless you guard with a value equality
   check — the React 19 lint catches this. Prefer deriving during render; when
   state genuinely must be adjusted because a prop changed, use React's
   render-phase adjustment (compare against a "last seen" state, set both) —
   never an effect. `src/hooks/use-account-roster.ts` shows the derived-loading
   shape, `use-realtime-campaign.ts` the render-phase reset.
4. **Realtime updates** go through `broadcastCampaignEvent` /
   `broadcastAccountEvent` from `src/lib/supabase/realtime`. The frontend
   subscribes via `useRealtimeCampaign` / `useRealtimeAccount` (`jobs`,
   `devices`, `attention` + presence on the account channel).
5. **Presentation vocabularies shared with the macOS client live in
   `src/lib/presentation/*`**, one label and one semantic tone per wire value,
   pinned to a JSON fixture under `__fixtures__/` that the Swift side copies
   and tests too (`attention.ts` ↔ `AttentionPresentation.swift`,
   `maintenance.ts` ↔ `MaintenancePresentation.swift`, `box-health.ts` ↔
   `BoxHealthPresentation.swift`, `slot-refusal.ts` ↔
   `SlotRefusalPresentation.swift`). A component never re-labels a wire value;
   the two cockpits change wording together or not at all.

### Quality gates (web)

```bash
npm run check    # typecheck + lint — must exit 0
npm run build    # the real integration check
```

Enforced by `.github/workflows/ci.yml` on every push and PR. `npm run lint`
must report **zero errors**; the remaining warnings (`<img>` vs `next/image`,
a few unused vars) are pre-existing and tracked, not a licence to add more.

## Modifying the database

- All tables are RLS-protected. Read `ARCHITECTURE.md` for the policy patterns.
- New columns: prefer adding them rather than overloading existing JSONB
  blobs. But sometimes encoding into an existing column (like the
  `[category] message` prefix in `campaign_jobs.error_message`) avoids a
  migration and ships faster — judge case by case.
- Migrations go through Supabase `apply_migration` MCP tool when working
 with an agent that has it; otherwise via `supabase migration new`.
 **Applying it is only half the job** — write the SQL to
 `supabase/migrations/` too, named with the exact version the database
 recorded, or the schema becomes unreproducible and the next agent cannot see
 what it is supposed to be. Read `supabase/migrations/README.md` first: the
 folder already carries a historical filename-vs-ledger divergence you must
 not extend.

## Tooling shortcuts

```bash
# Quick e2e test of the X automation against a real device
npx tsx scripts/x-reply.ts --box <host> --device <db_id> --tweet-url <url> --text "<text>"

# Same for TikTok
npx tsx scripts/tiktok-reply.ts --box <host> --device <db_id> --video-url <url> --text "<text>"

# ADBKeyboard provisioning (idempotent, serial)
node scripts/install-adbkeyboard.mjs --concurrency 1

# Read-only audit of ADBKeyboard state across devices
node scripts/audit-adbkeyboard.mjs
```

VMOS host limit: **10 containers running simultaneously max** per box.
Always respect with `--concurrency` on bulk scripts — the API itself does not
refuse an 11th start (measured 9 September 2026), and boots under contention
take 35–90 s instead of 10–17 s.

## VMOS vendor documentation (authoritative)

Do not work from memory on the VMOS API — the vendor ships machine-readable
references that are newer than the HTML docs:

- `https://help.vmosedge.com/ai-reference-container.txt` (Container API)
- `https://help.vmosedge.com/ai-reference-control.txt` (Android Control API v2)

Official agent skills are installed locally (gitignored, like `.agents/`):

```bash
npx skills add https://github.com/vmos-dev/vmos-edge-skills --skill vmos-edge-container-api
npx skills add https://github.com/vmos-dev/vmos-edge-skills --skill vmos-edge-control-api
```

Each box also serves the Container API as an **MCP server** at
`https://box-N.attila.army/mcp/sse` (CF-Access headers required; proprietary
"mcp-sse 1.0" transport, 65 tools). Each **running device** serves the Control
API v2 as an MCP server too, at
`https://box-N.attila.army/android_api/v2/{db_id}/mcp/sse` (MCP 2024-11-05,
20 tools including `system_shell` and `input_text`, no `accessibility_node`).
`.cursor/mcp.json` points at box-5 — the tool *surface* is identical on every
box, only the target differs, so one entry is enough for discovery.

**The VMOS MCP servers are development-time tools only.** Product code keeps
calling the box REST API through `src/lib/box-api/` (one module per concern,
`control-v2.ts` for the in-guest agent); never route runtime traffic through
them. Their real value is that they are a self-describing catalogue of what a
box actually serves — that is how we found `/interface_logs/{recent,stats,detail}`
(per-box API call log with success rates), `/v1/discover` and
`/v1/swap_size/{gb}`, none of which appear in the published documentation.
`.cursor/mcp.json` (gitignored) points at box-2 both over the LAN and through
the tunnel since 25 September 2026 (box-5, the previous entry, is unreachable).

**The product MCP is the one the macOS app hosts** (11 September 2026, see
`ARCHITECTURE.md` § "Cockpit MCP"): Cursor connects to `Attila.app` on
loopback, and every tool rides this repo's `nativeRoute` surface under the
signed-in user's JWT — the same cores as the UI, the same RLS, the same audit
trail (`X-Attila-Client: mcp`). Three surfaces exist for it here and nowhere
else: `/api/devices/[id]/screen` and `/api/devices/[id]/input` (the operator's
eyes and hands, guard-rails in the core — ADBKeyboard-only typing, hands off a
`bouncer`), and `/api/actions/directed` (a human's like/follow/comment,
executed by the Maintain loop as a `directed_action` task with the engine's
verification, ledger and proof). Two rules follow: a directed action is never a
shortcut around the blocks gate or the daily budget (the recipe refuses and
says why), and the Mac never drives a device for automation itself — it queues,
the server acts.

Two vendor facts worth remembering:

- **Read `model` from `GET /v1/get_hardware_cfg` before any vendor upgrade.**
  The fleet mixes `L1` (box-1..4) and `E1.01` (box-5) hosts; they do not share a
  kernel. That endpoint is also the only reliable source of the CBS version —
  `/v1/systeminfo` returns it blank on the 1.1.4.x line.
- **The v2 agent version tracks the Android image, not the host CBS.** Image
  `20260417` carries agent 1.1.1 (131 endpoints), `20260511`/`20260626` carry
  1.1.3 (137, strictly additive). `base/version_info`, `package/list` and
  `accessibility/dump` exist on both.
