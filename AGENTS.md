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
6. **Verify success actively, never optimistically.** Twitter: focus must
   return to `TweetDetailActivity`. TikTok: typed text must no longer be in
   any `EditText` node.
7. **Always throw a `JobError` with a typed category for known failure
   modes** (`account_logged_out`, `content_unavailable`, etc.). This is
   what the operator sees as a coloured badge in the automator panel —
   don't bury it in a generic `Error`.

## Hard rules — frontend

1. **Tailwind v4 + shadcn/ui (base-nova).** Don't import unrelated UI libs.
2. **Server components by default.** Reach for `"use client"` only when you
   need state, effects, or browser-only APIs.
3. **No setState inside an effect** unless you guard with a value equality
   check — the React 19 lint catches this.
4. **Realtime updates** go through `broadcastCampaignEvent` /
   `broadcastAccountEvent` from `src/lib/supabase/realtime`. The frontend
   subscribes via `useCampaignChannel` / `useAccountChannel`.

## Modifying the database

- All tables are RLS-protected. Read `ARCHITECTURE.md` for the policy patterns.
- New columns: prefer adding them rather than overloading existing JSONB
  blobs. But sometimes encoding into an existing column (like the
  `[category] message` prefix in `campaign_jobs.error_message`) avoids a
  migration and ships faster — judge case by case.
- Migrations go through Supabase `apply_migration` MCP tool when working
  with an agent that has it; otherwise via `supabase migration new`.

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
