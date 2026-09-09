# X-AUTOMATE — Twitter/X automation via ADB on VMOS

> Reference for posting replies on Twitter/X through VMOS Android containers.
> Last validated: 18 April 2026 — `box-1.attila.army`, AOSP 13, 1080×2340.
> **Re-tested live on 9 September 2026 — see the section at the end: the
> focus-return success gate produced a false `done`, and the coordinate flow
> is superseded by the selector-based path described there.**

---

## Source of truth

| File | Role |
|---|---|
| `src/lib/automation/x-reply.ts` | High-level `postReply(tunnelHostname, dbId, tweetUrl, text)` |
| `src/lib/automation/adb-helpers.ts` | Shared Android helpers (wake, IME, type, focus) |
| `src/lib/box-api.ts` | VMOS HTTP layer (shell, screenshot, container lifecycle) |
| `src/lib/automation/errors.ts` | `JobError` + categories surfaced in the dashboard |
| `scripts/x-reply.ts` | Thin CLI wrapper around `postReply` for manual debugging |

The browser/Chrome flow has been **removed** — it never worked reliably and
the deep link always opens the native app anyway. Only the native-app flow
is supported.

---

## Pre-conditions

The caller (`pipeline/executor` or the CLI script) is responsible for:

1. **Container fully booted** — `ensureContainerReady()` polls
   `getprop sys.boot_completed=1` (timeout 90 s). Without this the device
   may report "running" while still in early boot, every shell call returns
   VMOS code 201 silently, and the automation taps into the void.
2. **Original IME captured for restore** — `executor.executeJob()` snapshots
   `getCurrentIme()` before invoking `postReply` and restores it from a
   `finally` block so the operator never lands on ADBKeyboard.
3. **Twitter app `com.twitter.android` installed and signed in** —
   `postReply` checks installation and throws `device_setup_required`
   if missing. Login state is detected on the first UI dump (see below).

---

## Flow (validated step-by-step)

| Step | Action | What it does |
|---|---|---|
| 1 | `isPackageInstalled(com.twitter.android)` | Throws `device_setup_required` if missing |
| 2 | `wakeDevice()` | WAKEUP + MENU + verify, retry with swipe-up |
| 3 | `am force-stop com.twitter.android` | Clean entry point — no inherited composer |
| 4 | `am start -a VIEW -d <tweet>` | Deep link routes to the native app |
| 5 | `waitForFocus("TweetDetailActivity", 15 s)` | Bounded polling, throws `ui_unexpected` on timeout |
| 6 | `tryUiDump()` + `detectBlockingState()` | Throws `account_logged_out` / `content_unavailable` if matched |
| 7 | `screenshot()` → **SOURCE** | Adaptive cache busting via hash retry |
| 8 | `input tap 540 2277` | Opens the composer |
| 9 | `activateAdbKeyboard()` | `pm enable` + `ime enable` + `ime set` + verify |
| 10 | `input tap 540 2277` | Re-tap — composer steals focus during IME swap |
| 11 | `typeText(text)` | `am broadcast -a ADB_INPUT_TEXT --es msg "…"`, verifies "Broadcast completed" |
| 12 | `screenshot()` → **PROOF** | Composer + typed text + active "Répondre" button |
| 13 | `input tap 947 2220` | Submit |
| 14 | `getCurrentFocus()` | Must contain `TweetDetailActivity` — otherwise throws `ui_unexpected` |

Total typical duration: **~17 s**.

---

## Coordinates (1080 × 2340, FR locale)

| Element | Coordinates | Notes |
|---|---:|---|
| Reply field (entry point on tweet detail) | `(540, 2277)` | Same coord re-tapped after IME swap |
| Submit button (active "Répondre") | `(947, 2220)` | Only clickable once text is typed |

⚠️ The X composer is a **fragment within `TweetDetailActivity`**, not a
new activity. `dumpsys window | grep mCurrentFocus` returns the same
window class whether the composer is open or not — that's why we cannot
use focus alone to detect "composer up" (we use the screenshot proof
instead).

---

## Screenshot proofs

| Capture | When | Proves |
|---|---|---|
| **SOURCE** | Right after `waitForFocus(TweetDetailActivity)` | We are looking at the right tweet |
| **PROOF** | Composer open with text typed + active submit button | What we are about to send |

This is **not** a screenshot of the post going live — that signal is
unreliable on X (most-relevant sort, shadow ban, propagation delay). The
on-device success signal is `getCurrentFocus()` returning to the tweet detail
state right after the submit tap.

### Off-device cross-check (TikHub) — shadow-ban robust

The focus-return gate confirms the app *accepted* the reply, not that it is
live. A secondary, non-blocking check (`src/lib/social-verify/tikhub.ts`,
gated by `TIKHUB_API_KEY`) fetches the **avatar's own** reply timeline
(`fetch_user_tweet_replies`) and matches on `in_reply_to_status_id_str` /
text. This is shadow-ban robust: a reply hidden inside the target thread
still shows on the author's timeline. Run after a successful X job in
`api/pipeline/execute`; it only annotates logs (confirmed vs
shadowban-suspected) and never flips the job. Also pre-grants runtime
permissions (`grantAppPermissions`) so no system dialog blocks the reply.

VMOS caches `/container_api/v1/screenshots/<dbId>` server-side for ~5 s.
`screenshot()` in `box-api.ts` retries up to 3× when the SHA-256 of the
returned JPEG matches the previous capture for that device — bounded
3 s wait, never blocks on a genuinely static screen.

---

## Text input — ADBKeyboard is mandatory

`input text` and `input keyevent` are **silently dropped** by the X
composer (anti-bot protection). Only the IME broadcast path works:

```bash
am broadcast -a ADB_INPUT_TEXT --es msg "…"
```

For this to land, ADBKeyboard must be the active IME at the moment of
the broadcast. `executor.executeJob()` saves the previous IME, the
flow swaps to ADBKeyboard, types, taps submit, and the wrapper restores
the original IME from `finally` even on crash. Operators never see the
"ADB Keyboard {ON}" banner outside an active job.

ADBKeyboard provisioning on a fresh device requires `pm enable` after
the APK install — without it, `ime enable` returns "Unknown input
method". See `ADB-REFERENCE.md`.

---

## Error categories surfaced

| Category | When | Operator action |
|---|---|---|
| `container_not_ready` | VMOS code 201 mid-flow | Wait, retry |
| `device_setup_required` | X app or ADBKeyboard missing | Provision the device |
| `account_logged_out` | UI markers "Connecte-toi" / "Sign in to X" / `LoginActivity` | Re-login the avatar |
| `content_unavailable` | "This Post is unavailable", "compte suspendu" | Skip — post will never succeed |
| `ui_unexpected` | Timeout on `waitForFocus`, focus didn't return after submit | Investigate (likely UI change) |

All categories are encoded as `[category]` prefix in
`campaign_jobs.error_message` and rendered as a coloured badge in the
automator pipeline list.

---

## Manual test

```bash
npx tsx scripts/x-reply.ts \
  --box box-1.attila.army \
  --device EDGEQ3CM8BJHIE64 \
  --tweet-url "https://x.com/semafor/status/2045179739766215016" \
  --text "test"
```

Saves `screenshot_source_<ts>.jpg` and `screenshot_proof_<ts>.jpg`
beside the script (gitignored). The CLI wrapper does **not** restore the
IME — only the pipeline executor does. Restart the device or re-run the
pipeline to bring Gboard back after a CLI test.

---

## Live test — 9 September 2026 (what changed since April)

Full record in `MAINTENANCE-AGENT.md` §2. Two runs on box-2 / box-3 devices,
production code unchanged.

### The focus-return gate is a false-positive generator

`postReply` on US24 (`EDGE5R3QHJ8G7MUS`, X 11.97.0) returned **SUCCESS** in
37.8 s: focus came back to `TweetDetailActivity`. The PROOF screenshot shows
**"Cannot retrieve posts at this time"** — the tweet never loaded, the text
was typed into nothing, TikHub confirms zero replies on the account. No UI
dump ran in that flow, so `detectBlockingState` never saw the
`network_unavailable` marker it already knows. Three minutes later the app
sent the account to `BouncerWebViewActivity` (Cloudflare "Performing security
verification", never completing); TikHub then reported the account as
**suspended**. Its state before the test is unknown — it had never been
probed. **Rule: probe TikHub before acting, read the tree before typing, and
accept success only on a positive signal (see below).**

### Screen states met on 30 devices (versions 11.83 → 12.21)

| State | Marker | Meaning |
|---|---|---|
| Version wall | "This app is out of date. Update now" / "Esta app está desactualizada" | Blocks everything; seen on **9 of 16** readable screens, all versions ≤ 12.5 |
| Play Store sheet | top package `com.android.vending`, "Mise à jour disponible… Mettre à jour" | Soft update prompt (12.21.1), dismissable |
| Payment state | "Failed to load payment state" · Close | Transient, dismissable |
| Content unavailable | "Cannot retrieve posts at this time" | Restricted/suspended account or blocked exit IP — never type |
| Bouncer | `com.twitter.bouncer.BouncerWebViewActivity`, "Performing security verification" | Challenge — operator escalation, never retried |
| Slow load | black screen, spinner, only "Fermer" after 9 s | Wait and re-read |
| Feed OK | "For you" / "Pour vous", "Following" / "Abonnements", "Home" / "Accueil" | Logged in |

None of the first five are classified by the current detectors; the version
wall and the bouncer are the two that matter most.

### Selector-based reply, validated end to end (FR32, X 12.21.1, FR locale)

Manual replay of the target flow with the Control API v2 — one real reply
posted and confirmed:

| Step | How | Note |
|---|---|---|
| Probe account | TikHub `fetch_user_profile` | `active` — never act on `suspended` |
| Open tweet | `am start -a VIEW -d <url> com.twitter.android` | package qualifier as for TikTok |
| Read | `GET /android_api/v2/{db}/accessibility/dump_compact` | 0.5–1.2 s; tree shows "Postez votre réponse", `EditText resource-id="post-detail-reply-text-field"` |
| Focus field | `accessibility/node` with `{"xpath":"//*[@resource-id=\"post-detail-reply-text-field\"]"}` + `click` | X ids have **no package prefix**: the `resource_id` selector misses them, xpath works |
| Type | `activateAdbKeyboard()` + `typeText()` | unchanged hard rule; the typed text is then readable in the focused `EditText` |
| Submit | `accessibility/node` with `{"xpath":"//*[@text=\"Répondre\"]"}` + `click` | the reply **icon** carries the same word as `content-desc`; `@text` selects the button |
| **Verify** | `dump_compact` again | our text present as a `TextView` (not `EditText`), authored "Kylian Moretti · 1s", field empty again |
| Off-device | TikHub `fetch_user_tweet_replies` | reply visible **39 s** after posting |

This is the positive-signal contract TikTok already has and X lacks:
**success = our reply read back in the conversation tree**, not "the
composer closed". Coordinates `(540, 2277)` / `(947, 2220)` are kept above
for history only; they must not be reused.
