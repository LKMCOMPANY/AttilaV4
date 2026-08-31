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
| `infra/boxes/MAINTENANCE.md` | **Anything about a box itself** — disk, boot health, device provisioning, scrcpy tuning, stream diagnosis, vendor upgrades, proxy hygiene |
| `PROXY-STRATEGY.md` | Proxy assignment, testing, and the exit-IP geo check |
| `VMOS-API-V2-EVALUATION.md` | The Android Control API v2 — measured agent versions, MCP, what to adopt and what not to |

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

These columns are **observed, not enforced**: the pipeline's device selector is
unchanged and nothing filters on `boot_health` yet. Wiring it in is a deliberate
follow-up, with the tests that belong to it.

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
   (`blocked_*`) or ad-hoc gating — one table, one gate.

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
   subscribes via `useCampaignChannel` / `useAccountChannel`.

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
Always respect with `--concurrency` on bulk scripts.

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
`https://box-N.attila.army/mcp/sse` (CF-Access headers required).
`.cursor/mcp.json` points at box-5 — the tool *surface* is identical on every
box, only the target differs, so one entry is enough for discovery.

**The MCP is a development-time tool only.** Product code keeps calling the box
REST API through `src/lib/box-api.ts`; never route runtime traffic through MCP.
Its real value is that it is a self-describing catalogue of what a box actually
serves — that is how we found `/interface_logs/{recent,stats,detail}` (per-box
API call log with success rates), `/v1/discover` and `/v1/swap_size/{gb}`, none
of which appear in the published documentation.

Two vendor facts worth remembering:

- **Read `model` from `GET /v1/get_hardware_cfg` before any vendor upgrade.**
  The fleet mixes `L1` (box-1..4) and `E1.01` (box-5) hosts; they do not share a
  kernel. That endpoint is also the only reliable source of the CBS version —
  `/v1/systeminfo` returns it blank on the 1.1.4.x line.
- **The v2 agent version tracks the Android image, not the host CBS.** Image
  `20260417` carries agent 1.1.1 (131 endpoints), `20260511`/`20260626` carry
  1.1.3 (137, strictly additive). `base/version_info`, `package/list` and
  `accessibility/dump` exist on both.
