# X-AUTOMATE — Twitter/X automation via ADB on VMOS

> Reference for posting replies on Twitter/X through VMOS Android containers.
> Last validated: 18 April 2026 — `box-1.attila.army`, AOSP 13, 1080×2340.

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
real success signal is `getCurrentFocus()` returning to the tweet detail
state right after the submit tap.

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
