# TIKTOK-AUTOMATE — TikTok automation via ADB on VMOS

> Reference for posting comments on TikTok through VMOS Android containers.
> Coords validated 18 April 2026 — `box-1.attila.army`, AOSP 13, 1080×2340.

---

## Source of truth

| File | Role |
|---|---|
| `src/lib/automation/tiktok-reply.ts` | High-level `postTikTokComment(tunnelHostname, dbId, videoUrl, text)` |
| `src/lib/automation/adb-helpers.ts` | Shared Android helpers (wake, IME, type, focus, UI dump) |
| `src/lib/box-api.ts` | VMOS HTTP layer (shell, screenshot, container lifecycle) |
| `src/lib/automation/errors.ts` | `JobError` + categories surfaced in the dashboard |
| `scripts/tiktok-reply.ts` | Thin CLI wrapper for manual debugging |

---

## Pre-conditions

The caller (`pipeline/executor` or the CLI script) is responsible for:

1. **Container fully booted** — `ensureContainerReady()` (see X-AUTOMATE.md).
2. **Original IME captured for restore** — done by `executor.executeJob()`.
3. **TikTok app `com.zhiliaoapp.musically` installed and signed in.**
4. **GDPR / ads consent dialog already acknowledged** on this device. The
   first-launch dialog blocks all interaction — `postTikTokComment` detects
   it and throws `consent_required` with an explicit operator message.

---

## Flow (validated step-by-step)

| Step | Action | What it does |
|---|---|---|
| 1 | `isPackageInstalled(com.zhiliaoapp.musically)` | Throws `device_setup_required` if missing |
| 2 | `wakeDevice()` | WAKEUP + MENU + verify |
| 3 | `am force-stop com.zhiliaoapp.musically` | Clean cold-start on the target video |
| 4 | `am start -a VIEW -d <video>` | Deep link routes to native app |
| 5 | sleep `videoLoad` (8 s) | Cold start + first frame |
| 6 | `tryUiDump()` + `detectBlockingState()` | Throws `consent_required` / `account_logged_out` / `content_unavailable` if matched |
| 7 | `screenshot()` → **SOURCE** | Adaptive cache busting via hash retry |
| 8 | `input tap 970 1500` | Opens the comments panel (right-column comment icon) |
| 9 | sleep `panelSlide` (2.5 s) | Bottom sheet slide animation |
| 10 | `input tap 450 2262` | Focuses the comment input field |
| 11 | `activateAdbKeyboard()` | `pm enable` + `ime enable` + `ime set` + verify |
| 12 | `input tap 450 2262` | Re-tap — composer steals focus during IME swap |
| 13 | `typeText(text)` | `am broadcast -a ADB_INPUT_TEXT --es msg "…"` |
| 14 | `screenshot()` → **PROOF** | Composer + typed text + active ↑ submit button |
| 15 | `input tap 970 1515` | Submit |
| 16 | sleep `postSubmit` (4 s) | Network round-trip |
| 17 | `tryUiDump()` + `isTextStuckInEditText(text)` | Throws `rate_limited` if the typed text is still in an EditText |
| 18 | `input keyevent KEYCODE_BACK` | Best-effort: collapse the panel |

Total typical duration: **~38 s**. The big chunks are the 8 s video
load and the ~12 s `uiautomator dump` (TikTok rarely reaches the idle
state required by uiautomator while the video is playing).

---

## Coordinates (1080 × 2340, FR locale)

| Element | Coordinates | Notes |
|---|---:|---|
| Comment icon (right action column) | `(970, 1500)` | Speech bubble — opens the comments panel |
| Comment input field | `(450, 2262)` | Centre of "Ajouter un commentaire" placeholder |
| Submit button (active ↑) | `(970, 1515)` | Same column as comment icon — only visible while composer is up |

⚠️ The submit button is at the same X as the comment icon, just visible
in a different state. Always tap **after** the composer is open with
text in the field, otherwise the tap collapses the panel.

---

## Screenshot proofs

| Capture | When | Proves |
|---|---|---|
| **SOURCE** | After 8 s video load + blocker check | The video we are commenting on |
| **PROOF** | Composer open + typed text visible + active ↑ button | What we are about to send |

The post-submit verification scans the UI tree for the typed text **only
inside `EditText` nodes**. The just-posted comment also renders as a
`TextView` in the comments list, so a naive `ui.includes(text)` check
would falsely flag the success as failure.

---

## Submit verification — best-effort

TikTok keeps the composer open after a successful submit (only the field
is cleared). We don't get a focus change like X. The verification path is:

1. After the submit tap and `postSubmit` sleep, `tryUiDump()` (compressed).
2. If the dump succeeds and the typed text is still present in an
   `EditText` node → throw `rate_limited`.
3. If the dump fails (uiautomator idle state lost — common on TikTok)
   or no `EditText` is exposed (Compose-style composer compressed) → trust
   the submit and return success.

This is intentionally best-effort: we only flag a positive failure
signal, never a missing-evidence one. False negatives on the verification
are caught by operators monitoring the comment count on the video.

---

## Error categories surfaced

| Category | When | Operator action |
|---|---|---|
| `container_not_ready` | VMOS code 201 mid-flow | Wait, retry |
| `device_setup_required` | TikTok app or ADBKeyboard missing | Provision the device |
| `consent_required` | First-launch GDPR / ads consent dialog | Manually ack the dialog on the device once |
| `account_logged_out` | UI markers "Connecte-toi à TikTok" / "Log in to TikTok" / `LoginActivity` | Re-login the avatar |
| `content_unavailable` | "Vidéo non disponible", "Couldn't find this account" | Skip — video deleted/private |
| `rate_limited` | Submit succeeded ADB-side but text stuck in field | Pause this avatar, throttle |

---

## Consent dialog — known operational blocker

On the very first TikTok launch after install, TikTok shows a full-screen
dialog **"Choisir comment afficher les publicités"** / **"Choose your
ads experience"** with two "Pubs personnalisées / Pubs génériques"
options. Until an operator taps one of them, every interaction is
swallowed and the comment flow throws.

The detection covers FR + EN locales. To unblock a device:

1. Open the device in the operator panel
2. Stream → tap "Sélectionner" on either option
3. Re-run the job — the dialog stays dismissed permanently for that
   user_data partition

We do **not** auto-accept on behalf of the avatar (consent must be
explicit).

---

## Manual test

```bash
npx tsx scripts/tiktok-reply.ts \
  --box box-1.attila.army \
  --device EDGE8DK15O299ST5 \
  --video-url "https://www.tiktok.com/@usatoday/video/7611827582148906270" \
  --text "test"
```

Saves `tiktok_source_<ts>.jpg` / `tiktok_proof_<ts>.jpg` beside the
script (gitignored). Pointer-location calibration mode:

```bash
npx tsx scripts/tiktok-reply.ts --calibrate --box <host> --device <db_id>
# disable
npx tsx scripts/tiktok-reply.ts --calibrate --off --box <host> --device <db_id>
```
