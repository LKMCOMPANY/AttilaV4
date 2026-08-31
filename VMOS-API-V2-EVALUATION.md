# VMOS Android Control API v2 — evaluation & recommendation

Status: evaluation only (no automation flow was rewritten). Scope: whether to
move parts of the automation off `android_api/v1/shell` + `input …` +
`uiautomator dump` onto the newer **Android Control API v2**
(`/android_api/v2/{db_id}/…`). References:
[agent-api](https://help.vmosedge.com/en/sdk/agent-api.html),
[container-api](https://help.vmosedge.com/en/sdk/container-api.html).

## TL;DR

- **Adopt now (low risk):** use v2 `GET /accessibility/dump` for the UI-tree read
  path. It returns the full hierarchy as JSON — this removes our on-device
  `uiautomator dump --compressed | gzip | base64` workaround that exists only to
  beat the ~4 KB shell-stdout truncation (`adb-helpers.ts` `UI_DUMP_CMD`).
- **Pilot behind a flag (medium risk):** v2 `/input/click`, `/input/swipe`,
  `/input/bezier_scroll` for taps/scrolls, and `/accessibility/node`
  (find-and-act by `resource_id`/`text`/`xpath`) to replace fragile coordinate
  taps in navigation. Bezier scroll is plausibly more human-like than a
  straight-line `input swipe`.
- **Do NOT change (keep as-is):** text entry into social apps stays on the
  **ADBKeyboard IME broadcast** (`AGENTS.md` hard rule 3). v2 `/input/text` and
  `accessibility set_text` are the same classes of injection that anti-bot
  protections silently drop / flag. Keep the positive-signal success
  verification contract unchanged.

## Version prerequisites — measured, not assumed (2026-08-31)

v2 needs image ≥ `…20260110` and CBS ≥ `1.1.1.10`; `/accessibility/node`
(find-and-act) needs image ≥ `…20260201`. The whole fleet clears both.

The earlier version of this document suggested probing `base/version_info` "to
confirm the control service is present". That has now been done on a running
device per box, and it corrected two assumptions:

**The agent is not `1.0.8`, and it is not uniform.**

| box | image | agent | endpoints |
|---|---|---|---|
| box-2, box-3 | `…20260417` | **1.1.1** | 131 |
| box-4 | `…20260511` | **1.1.3** | 137 |
| box-5 | `…20260626` | **1.1.3** | 137 |

**The agent version tracks the Android IMAGE, not the host CBS.** box-1 runs the
newest CBS on the fleet (`1.1.6.12.1`) with the oldest image (`…20260307`), so a
CBS check tells you nothing about the agent. Read `base/version_info` on a
running device, or infer from the image date.

The 1.1.1 → 1.1.3 gap is strictly additive — six endpoints, none removed:
`activity/browse`, `media/inject`, `media/inject_status`, `package/info`,
`proxy/get`, `proxy/set_enabled`. **Everything this evaluation recommends
(`accessibility/dump`, `accessibility/node`, `input/*`) exists on both**, so the
phased adoption below is safe fleet-wide.

Two smaller corrections: `base/supported_list` is not a route (404) — the list
is embedded in `base/version_info`. And the `ve` CLI the vendor documents as
preinstalled at `/data/local/tmp/ve` from API 1.0.9 is **absent** on our images
despite the agent being well past that version; do not build on it.

## Beyond HTTP: MCP and the official skills

The vendor ships two things worth knowing about, neither of which was on our
radar when this evaluation was written:

- Each box serves the Container API as an **MCP server** at
  `https://box-N.attila.army/mcp/sse` (CF-Access headers required, works through
  our tunnel). It is a **development-time tool only** — product code keeps
  calling REST through `src/lib/box-api.ts`. Its value is being a self-describing
  catalogue of what a box actually serves: that is how we found
  `/interface_logs/{recent,stats,detail}` (per-box API call log with success
  rates), `/v1/discover` and `/v1/swap_size/{gb}`, none of which appear in the
  published documentation.
- Official agent skills at [vmos-dev/vmos-edge-skills](https://github.com/vmos-dev/vmos-edge-skills),
  installed locally (gitignored) — see `AGENTS.md`.

The vendor also publishes AI-oriented references that are fresher than the HTML
docs: `help.vmosedge.com/ai-reference-container.txt` and
`…/ai-reference-control.txt`.

## What v2 gives us vs the current v1 shell approach

- **UI tree**: v1 = `uiautomator dump` to a file, then gzip+base64 through the
  shell to dodge truncation, then inflate + parse. v2 = one `GET
  /accessibility/dump` returning XML in `data`. Same parser (`ui-tree.ts`) can
  consume it; we just drop the shell gymnastics. Fewer moving parts, fewer
  "could not get idle state" empty dumps to retry.
- **Find + act by selector**: v2 `/accessibility/node` finds by
  `resource_id`/`text`/`xpath` with a `wait_timeout` and performs `click` /
  `scroll_*` / `ime_enter` in one call. This is far more robust than computing a
  coordinate from a parsed node and firing `input tap` — it survives layout
  shifts and removes a class of off-by-a-few-pixels taps.
- **Gestures**: `/input/bezier_scroll` and `/input/motion_event` (raw) allow
  curved, variable-speed gestures instead of `input swipe`'s straight line —
  a modest anti-detection improvement worth measuring.
- **Structured errors + request_id**: v2 responses carry a `request_id`, which
  makes support/debugging across the tunnel easier than parsing shell stdout.

## Why NOT to rewrite the social flows wholesale

The X/TikTok flows encode hard-won, verified behavior (`AGENTS.md`,
`X-AUTOMATE.md`, `TIKTOK-AUTOMATE.md`):

- **Text**: `input text` / `input keyevent` typing is dropped by anti-bot; only
  the ADBKeyboard IME broadcast lands. v2 `/input/text` and accessibility
  `set_text` inject through paths with the same detection risk — changing this
  is exactly the regression class the 18 April 2026 refactor fixed. Keep
  ADBKeyboard.
- **Success verification**: "verify from the UI tree with a positive signal;
  cannot-verify = failure." A v2 migration must feed the *same* verification
  contract — the dump source changing from shell to `/accessibility/dump` is
  fine; the decision logic must not be loosened.
- **TikTok composer**: a `uiautomator dump` collapses TikTok's composer, so the
  compose phase runs with NO dump. `/accessibility/dump` is the same underlying
  AccessibilityService — assume it has the same side effect until proven
  otherwise on a device. Do not enable dump-during-compose just because the
  transport changed.

## Recommended phased adoption

1. **Add a v2 client module** (`src/lib/box-api-v2.ts` or extend `box-api.ts`)
   with typed wrappers: `dumpAccessibility(dbId)`, `nodeAction(dbId, selector,
   action)`, `inputClick/Swipe/BezierScroll(dbId, …)`, `apiVersion(dbId)`.
   Reuse `boxFetch` (now timeout+retry aware). Base path
   `/android_api/v2/{db_id}/…`.
2. **Swap the READ path first**: make `dumpUiNodes` prefer `GET
   /accessibility/dump` and fall back to the existing shell path if v2 is
   unavailable/empty. This is behavior-preserving (same parser, same callers)
   and immediately deletes the truncation hack risk. Verify on box-5 first.
3. **Pilot taps/scrolls** behind a per-flow flag: replace coordinate `tap()` and
   `input swipe` in NON-compose navigation with `/accessibility/node` click and
   `/input/bezier_scroll`. A/B against the current success rate before making it
   the default.
4. **Leave text + verification on the proven path.** Never route social-app text
   through v2.
5. **Consider `/accessibility/service_hidden`** (hide the accessibility service
   from the target app's list) as an anti-detection measure if we lean on
   accessibility actions — test its effect on X/TikTok behavior.

## Already adopted: v2 as a health signal (2026-08-31)

One piece of v2 is in production, and it is not on the automation path.
`GET /android_api/v2/{db_id}/base/version_info` is the cheapest possible proof
that Android is alive, because the agent runs *inside* the guest. magicbox-proxy
1.2.0 crosses it with a real WebSocket handshake against the scrcpy port, so
`/stream-ready` can distinguish "still booting" from "Android is up but the
projection stack is dead" — the zombie devices whose only known remedy used to
be restarting the whole container.

This is read-only, touches no flow, and is available on both agent versions.
See `ARCHITECTURE.md` § "Sonde de disponibilité" and
`infra/boxes/MAINTENANCE.md` § 4.

## Net

v2 is a real upgrade for the **read/inspect** and **navigation** paths and
should be adopted incrementally, read-path first. It is **not** a reason to
touch text entry or the success-verification contract, which are the parts that
actually keep jobs honest. No automation flow has been changed; implementation
is a follow-up once step 1–2 are validated on box-5.
