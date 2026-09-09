# TIKTOK-AUTOMATE — TikTok automation via ADB on VMOS

> Reference for posting comments on TikTok through VMOS Android containers.
> Coords validated 18 April 2026 — `box-1.attila.army`, AOSP 13, 1080×2340.
> **Re-tested live on 9 September 2026 — see the section at the end: on
> TikTok 44.8.3 the coordinate flow opened the camera instead of the
> comments, while a selector-based replay posted and verified a comment.**

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

## Flow (validated step-by-step, 07/2026)

Every load-bearing step is verified from the UI tree; a step that can't be
proven aborts with a typed error instead of pressing on.

| Step | Action | What it does |
|---|---|---|
| 1 | `isPackageInstalled(com.zhiliaoapp.musically)` | Throws `device_setup_required` if missing |
| 2 | `grantAppPermissions()` | Pre-grants CAMERA/RECORD_AUDIO/notifications so no system dialog blocks mid-flow |
| 3 | `wakeDevice()` | WAKEUP + MENU + verify |
| 3b | `waitForSystemReady()` | Gate 0 — wait until the launcher owns `mCurrentFocus` (a real `Window{…}`, not `null`). On a loaded host `boot_completed` fires while services still start; deep-linking into that race makes the app never foreground |
| 4 | `am force-stop`, then `relaunchUntilFocus(am start -a VIEW -d <video> com.zhiliaoapp.musically)` | **Package qualifier required** (else the intent lands on the For-You feed). Gate 1 — fire the deep link and confirm TikTok owns the foreground; a loaded/slow box sometimes swallows the first launch, so re-fire the cheap `am start` up to 3× (22 s each) before failing `app_not_ready`. Far cheaper than failing → cold-restarting (~120 s on a slow box). Validated on box-1 (07/2026) |
| 6 | sleep `videoSettle` (8 s) | Right action column only becomes tappable after first frames |
| 7 | `dumpUiXml()` + `detectBlockingState()` | Throws `consent_required` / `account_logged_out` / `content_unavailable` |
| 8 | `screenshot()` → **SOURCE** | Evidence only |
| 9 | `openCommentsPanel()` | Gate 2 — tap comment icon candidates, POLL until the "Comments" sheet or an `EditText` is observed (never re-tap an open panel — that closes it) |
| 10 | snapshot comment count | Baseline for the post-submit +1 check |
| 11 | tap field → `activateAdbKeyboard()` → re-tap → `typeText()` | Compose blind (NO dump — a dump collapses the composer) |
| 12 | `screenshot()` → **PROOF** | Composer + typed text, evidence only |
| 13 | `input tap` send | Submit |
| 14 | `verifySubmission()` | Gate 3 — positive confirmation (comment in list OR count +1); `rate_limited` on silent drop; `ui_unexpected` if unreadable |
| 15 | `input keyevent KEYCODE_BACK` | Best-effort: collapse the panel |

Total typical duration: **~40 s**. Validated live on box-1 (07/2026): confirmed
publication via count increment on multiple videos; a rapid duplicate correctly
rejected as `rate_limited`.

---

## Coordinates (1080 × 2340)

| Element | Coordinates | Notes |
|---|---:|---|
| Comment icon (right action column) | candidates `(980,1535)`, `(980,1600)`, `(980,1475)` | Y drifts per video (caption length). The video surface has no a11y nodes, so we try candidates in the safe band **between** the like heart (~1360) and the bookmark (~1720) and verify the panel opened. Never higher — tapping the heart likes the video. |
| Comment input bar | `(540, 2262)` | Bottom-centre "Add a comment" bar; tapping it spawns the real `EditText` |
| Submit button (active ↑) | `(970, 1515)` | Only clickable once the composer holds text |

⚠️ Opening is gated by observation, not a blind tap: `openCommentsPanel`
polls the tree after each candidate tap and stops as soon as the "Comments"
sheet / an `EditText` appears — re-tapping an already-open panel closes it.

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

## Submit verification — positive confirmation (rewritten 07/2026)

> The old "best-effort" check trusted the submit whenever it *couldn't* read
> the tree. On TikTok that dump fails constantly, so ~90% of a live campaign's
> "done" jobs had posted nothing (splash screens, logged-out accounts,
> permission pop-ups). The rule is now inverted: **"cannot verify" = FAILURE,
> never success**, and success needs a POSITIVE signal.

Screenshots are evidence only — never an input to the success decision (a
laggy frame must not create a false `done`). Confirmation comes from the UI
accessibility tree:

1. Snapshot the comment count from the panel title *before* the send tap.
2. After the send tap, poll the tree (up to `SUBMIT_POLL_ATTEMPTS`) for a
   POSITIVE signal:
   - our comment rendered as a **posted item** in the list — any node that is
     NOT the input `EditText` whose text matches (definitive), or
   - the **comment count incremented** by ≥1 while our text is no longer in an
     `EditText` (corroborating).
3. Typed text still sitting in an `EditText` → `rate_limited` (hard negative).
4. TikTok left the foreground (permission dialog, launcher, login) → failure.
5. Field cleared but neither positive signal after the full poll → treat as a
   silent drop / throttle → `rate_limited`. A tree we could never read →
   `ui_unexpected`. Never an optimistic pass.

Note the composer phase runs with **no `uiautomator dump`** between focusing the
field and the send tap — a dump collapses TikTok's composer and drops input
focus (verified on box-1). All verification is deferred to after the submit.

> **Measured 9 September 2026:** this side effect belongs to `uiautomator
> dump`, not to the accessibility service itself. A Control API v2
> `GET /accessibility/dump_compact` taken **while the composer holds typed
> text** left the composer open with focus intact (screenshot-verified). Once
> the read path moves to v2, the compose phase becomes observable.

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

---

## Live test — 9 September 2026 (what changed since July)

Full record in `MAINTENANCE-AGENT.md` §2. Device US13 (`EDGEMK9EWI0B3EAJ`,
box-2, TikTok 44.8.3, EN locale), target video @nba with 49 comments.

### The coordinate flow failed, correctly

`postTikTokComment` returned `[ui_unexpected] Could not confirm submission`
after **99 s**, nothing posted (TikHub-verified). The three pre-compose
`uiautomator dump` calls took **12 s each**. Then the "comment input bar" tap
`(540, 2262)` landed on the **Create (+)** button of the bottom navigation —
the comments sheet was not open at that moment — so the camera opened, the
text was broadcast into a screen without a field, and the "submit" tap
`(970, 1515)` hit the capture screen. The positive-signal verification held
(no false `done`); the hard-coded coordinates did not survive a layout change.

### Selector-based replay, one real comment posted and verified

| Step | How | Measured |
|---|---|---|
| Read | `GET /android_api/v2/{db}/accessibility/dump_compact` | 0.5–1.2 s, 33 KB, 0 empty reads out of 10 on a stable feed |
| Open comments | `accessibility/node` `{"xpath":"//*[contains(@content-desc,\"comments\")]"}` + `click` | matches "Read or add comments. 52 comments"; 90 ms on device |
| Focus field | `accessibility/node` `{"resource_id":"com.zhiliaoapp.musically:id/e02"}` + `click` | `text` selector on "Add comment..." **misses** (exact match, ellipsis); resource id works |
| Type | `activateAdbKeyboard()` + `typeText()` | unchanged hard rule |
| Observe | `dump_compact` during compose | composer stays open, `EditText` shows the text |
| Send | `accessibility/node` `{"resource_id":"com.zhiliaoapp.musically:id/cj9"}` + `click` | the send button's `content-desc` is an unresolved "@2131953937" — only the resource id is usable |
| **Verify** | `dump_compact` | our text present as a `TextView` (`…:id/eim`), `EditText` empty, count 52 → 53 |
| Off-device | TikHub `fetch_video_comments` | comment visible after ≈ 2 min |

Resource ids are per-build (`e02`, `cj9`, `eim` on 44.8.3) and must live in a
versioned per-app table, never in code constants; `content-desc` strings are
locale-dependent (EN "Read or add comments", FR "Lire ou ajouter des
commentaires", ES "Leer o añadir comentarios").

### Dialogs met on 17 devices

"Give TikTok access to your Facebook friends list and email?" (OK / Don’t
allow), "Link email" (OK / Not now), the FR ads-consent sheet, and the
logged-out account picker ("Welcome back", handle, "Log in", "Add another
account"). Only the last two are known to the current detectors. While a
dialog is up, `accessibility/dump` returns **only the dialog window** — the
feed underneath is not in the tree, so classify the top window first.
