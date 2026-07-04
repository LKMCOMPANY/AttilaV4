/**
 * Post a comment on TikTok via the native Android app.
 *
 * Pre-conditions enforced by the caller (`pipeline/executor`):
 *   - Container is fully booted (`ensureContainerReady`)
 *   - Original IME captured for restore in the surrounding try/finally
 *
 * Reliability contract (rewritten 07/2026 after a campaign audit found ~90%
 * of "done" TikTok jobs had posted nothing — splash screens, permission
 * pop-ups, logged-out accounts and blank home screens were all reported as
 * success). The rule now is: **every load-bearing step is positively verified
 * from the on-screen UI tree, and "cannot verify" means FAILURE, never an
 * optimistic pass.**
 *
 *   1. Runtime permissions are pre-granted so TikTok never raises a blocking
 *      system dialog mid-flow.
 *   2. After the deep link we wait for TikTok to actually own the foreground
 *      (mirror of the Twitter `waitForFocus` gate) — catches splash/black/
 *      launcher/notification states.
 *   3. Blocking states (logged out, consent, unavailable) are detected from a
 *      resilient UI dump before we touch anything.
 *   4. The comments panel must be observed open before we compose — catches
 *      wrong-screen taps and interstitials.
 *   5. Compose runs WITHOUT any `uiautomator dump` (a dump collapses TikTok's
 *      composer and drops focus), so verification is deferred to after submit.
 *   6. Publication is confirmed only by a POSITIVE UI-tree signal — our comment
 *      appears in the list, or the comment count increments. Text still stuck
 *      in the field, or an unreadable tree, is a failure; never an optimistic
 *      pass.
 *
 * Screenshots are evidence only, never an input to the success decision:
 * SOURCE proves the target video; PROOF proves the composer with our text.
 */

import {
  shell,
  shellSafe,
  screenshot,
  sleep,
  wakeDevice,
  isPackageInstalled,
  grantAppPermissions,
  isForegroundApp,
  activateAdbKeyboard,
  typeText,
  tap,
  waitForSystemReady,
  relaunchUntilFocus,
  androidDeepLink,
  dumpUiXml,
  dumpUiNodes,
  parseUiNodes,
  findCommentEditText,
  editTextContains,
  findInterstitialDismiss,
  isCommentsPanelOpen,
  countPostedMatches,
} from "./adb-helpers";
import { screenshotContainsText } from "./ocr";
import { encodeJobError, JobError } from "./errors";

const TIKTOK_PACKAGE = "com.zhiliaoapp.musically";
const PERMISSION_CONTROLLER = "com.android.permissioncontroller";

/**
 * Runtime permissions pre-granted before the flow so TikTok never raises a
 * focus-stealing system dialog ("Allow TikTok to take pictures…"). Best-effort:
 * any permission the build doesn't expose fails harmlessly (see
 * `grantAppPermissions`).
 */
const TIKTOK_PERMISSIONS = [
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
] as const;

// Fallback coordinates (1080×2340, validated 2026). The flow prefers UI-tree
// anchors; these are used only when a dump is momentarily unavailable.
const COORDS = {
  commentField: { x: 540, y: 2262 }, // collapsed "Add a comment" bar (bottom-centre)
  sendButton: { x: 970, y: 1515 },   // pink ↑ shown once the composer has text
} as const;

// The comment speech-bubble sits in the right action column at X≈980, but its
// Y drifts per video (a longer caption pushes the column up/down). TikTok's
// video screen is an opaque surface with no accessible nodes, so we can't read
// the icon from the UI tree — instead we try a few candidates spanning ONLY
// the safe band between the like heart (~1360) and the bookmark (~1720). Never
// higher: tapping the heart would like the video (an unwanted, visible
// footprint). Validated centre (980,1535) on box-1 / 1080×2340.
const COMMENT_BUTTON_CANDIDATES = [
  { x: 980, y: 1535 },
  { x: 980, y: 1600 },
  { x: 980, y: 1475 },
] as const;

const TIMING = {
  afterForceStop: 800,
  systemReadyMs: 30_000,       // wait for the launcher to own mCurrentFocus after boot
  foregroundTimeoutMs: 22_000, // per deep-link attempt (warm foregrounds in ~5s;
                               // a loaded cold box needs the margin + a re-fire)
  launchAttempts: 3,           // re-fire the deep link up to 3× before failing
  videoSettle: 8000,           // right action column only becomes tappable after
                               // the first frames load (~8s measured on box-1)
  panelSettle: 1800,           // comments bottom-sheet slide
  fieldFocus: 1200,            // field focus + keyboard raise
  afterImeSwitch: 800,
  afterType: 1500,
  beforeSubmit: 1000,
  // Short on purpose: TikTok echoes the just-posted comment at the TOP of the
  // still-open sheet for a moment, then re-sorts by relevance / collapses the
  // sheet. We must read that first window, so we poll quickly right after the
  // send tap instead of waiting out a long fixed delay.
  postSubmit: 1200,
} as const;

const OPEN_PANEL_ATTEMPTS = 3;
const PANEL_POLL_ATTEMPTS = 6; // ~6 × (dump + interval) after each comment tap

/**
 * Full-screen blocker markers, matched against the dumped UI text. Order
 * matters: auth screens also contain generic chrome, so we check them first.
 * Kept multilingual (FR/EN/ES/DE seen in the wild on our avatar accounts).
 */
const CONSENT_BLOCKERS = [
  "Choisir comment afficher",
  "Pubs personnalisées",
  "Choose your ads experience",
  "Personalized ads",
];

// TikTok-brand-qualified auth phrases only. We deliberately avoid generic
// substrings ("Log in", "Welcome back", "Se connecter") — they also appear on
// promotional / upsell surfaces of a *logged-in* session, and a false
// `account_logged_out` would wrongly tag a working avatar as blocked. If a
// logged-out variant slips past these, the positive publication gate still
// fails the job safely (just with a less specific category).
const LOGGED_OUT_MARKERS = [
  "Connecte-toi à TikTok",
  "Inscris-toi avec",
  "Log in to TikTok",
  "Sign up for TikTok",
  "Regístrate en TikTok",
  "Inicia sesión en TikTok",
];

// Second, compound auth signal: a LOGIN call-to-action and a SIGN-UP
// call-to-action visible on the SAME screen. Promotional surfaces of a
// logged-in session show at most one of the two; only real auth walls (e.g.
// the per-profile "Willkommen zurück <handle> / Anmelden / Registrieren"
// re-login screen seen on box-1, which none of the brand-qualified markers
// caught) present both. Each pair must match its own language — mixing
// languages across the pair would defeat the precision.
const AUTH_WALL_PAIRS: ReadonlyArray<readonly [login: string, signup: string]> = [
  ["Anmelden", "Registrieren"],           // DE
  ["Log in", "Sign up"],                  // EN
  ["Connexion", "Inscription"],           // FR
  ["Se connecter", "S'inscrire"],         // FR variant
  ["Iniciar sesión", "Registrarse"],      // ES
  ["Accedi", "Registrati"],               // IT
];

function isAuthWall(uiXml: string): boolean {
  return AUTH_WALL_PAIRS.some(([login, signup]) => uiXml.includes(login) && uiXml.includes(signup));
}

const CONTENT_UNAVAILABLE_MARKERS = [
  "Vidéo non disponible",
  "Cette vidéo n'est pas disponible",
  "Video currently unavailable",
  "This video is currently unavailable",
  "Couldn't find this account",
  "Compte introuvable",
];

function detectBlockingState(uiXml: string): JobError | null {
  if (CONSENT_BLOCKERS.some((m) => uiXml.includes(m))) {
    return new JobError(
      "consent_required",
      "TikTok consent dialog blocking — device requires a one-time manual ack",
    );
  }
  if (LOGGED_OUT_MARKERS.some((m) => uiXml.includes(m)) || isAuthWall(uiXml)) {
    return new JobError(
      "account_logged_out",
      "TikTok session expired or no avatar logged in on this device — operator must sign in again",
    );
  }
  if (CONTENT_UNAVAILABLE_MARKERS.some((m) => uiXml.includes(m))) {
    return new JobError(
      "content_unavailable",
      "Video is deleted, private, or unavailable in this region — skip this post",
    );
  }
  return null;
}

export interface TikTokReplyResult {
  success: boolean;
  source: Buffer;
  proof: Buffer;
  error?: string;
  durationMs: number;
}

function ttLog(dbId: string, step: string, data?: Record<string, unknown>) {
  console.log(`[TikTok-Reply][${dbId}] ${step}`, data ? JSON.stringify(data) : "");
}

export async function postTikTokComment(
  tunnelHostname: string,
  dbId: string,
  videoUrl: string,
  text: string,
): Promise<TikTokReplyResult> {
  const start = Date.now();
  ttLog(dbId, "postTikTokComment START", { videoUrl, textPreview: text.slice(0, 60) });

  // Captured progressively so partial flows still surface evidence to the
  // operator (a mid-flow failure keeps the composer-with-text proof).
  let source: Buffer = Buffer.alloc(0);
  let proof: Buffer = Buffer.alloc(0);

  try {
    if (!videoUrl || !videoUrl.trim()) {
      throw new JobError(
        "ui_unexpected",
        "Empty video URL — pipeline produced a job without a deep link target",
      );
    }

    if (!(await isPackageInstalled(tunnelHostname, dbId, TIKTOK_PACKAGE))) {
      throw new JobError(
        "device_setup_required",
        `TikTok app (${TIKTOK_PACKAGE}) not installed on device`,
      );
    }

    // Pre-grant so the camera/mic permission dialog never blocks the flow.
    await grantAppPermissions(tunnelHostname, dbId, TIKTOK_PACKAGE, TIKTOK_PERMISSIONS);

    await wakeDevice(tunnelHostname, dbId);

    // Gate 0 — wait for the window system to settle onto a real focused window
    // before firing the deep link. On a loaded host `sys.boot_completed=1`
    // fires while services are still starting and `mCurrentFocus` is null;
    // deep-linking into that race makes TikTok never reach the foreground.
    await waitForSystemReady(tunnelHostname, dbId, TIMING.systemReadyMs);

    // Force-stop guarantees the deep link cold-starts on the target video
    // instead of resuming a stale session on a different feed item.
    await shell(tunnelHostname, dbId, `am force-stop ${TIKTOK_PACKAGE}`);
    await sleep(TIMING.afterForceStop);

    // Gate 1 — route the deep link explicitly to TikTok (trailing package, so
    // the intent lands on the exact video detail, not the FYP) and confirm
    // TikTok owns the foreground. `androidDeepLink` uses the CANONICAL url
    // (drops the `?_r=1&u_code=…&source=h5_m` share params that both break the
    // shell command and make TikTok redirect to the FYP) and quotes it. On a
    // slow/loaded box the first `am start` is sometimes swallowed while the
    // system settles, so we re-fire the (cheap) deep link a few times before
    // giving up — far cheaper than failing and cold-restarting. Validated on
    // box-1 (07/2026).
    const deepLink = androidDeepLink(videoUrl, TIKTOK_PACKAGE);
    const foregrounded = await relaunchUntilFocus(
      tunnelHostname,
      dbId,
      deepLink,
      TIKTOK_PACKAGE,
      {
        attempts: TIMING.launchAttempts,
        perAttemptMs: TIMING.foregroundTimeoutMs,
        onRetry: (n) => ttLog(dbId, `TikTok not foreground — re-firing deep link (attempt ${n + 1})`),
      },
    );
    if (!foregrounded) {
      const xml = await dumpUiXml(tunnelHostname, dbId);
      const blocker = xml ? detectBlockingState(xml) : null;
      if (blocker) throw blocker;
      throw new JobError(
        "app_not_ready",
        `TikTok did not reach the foreground after ${TIMING.launchAttempts} deep-link attempts`,
      );
    }
    await sleep(TIMING.videoSettle);

    // Gate 2 — fail fast on a known blocking screen (consent, logged out,
    // unavailable) using a resilient dump.
    const preXml = await dumpUiXml(tunnelHostname, dbId);
    if (preXml) {
      const blocker = detectBlockingState(preXml);
      if (blocker) throw blocker;
    }

    ttLog(dbId, "source screenshot");
    source = await screenshot(tunnelHostname, dbId);

    // Gate 3 — open the comments panel (PROVE the "Comments" sheet is up).
    // Catches wrong-screen taps and interstitials.
    await openCommentsPanel(tunnelHostname, dbId);

    // Baseline snapshot BEFORE composing (dumping is still safe here — the
    // input field isn't focused yet). We record how many list items already
    // match our text so the post-submit check can require a genuinely NEW
    // matching item (duplicate- and foreign-safe).
    const baseline = await dumpUiNodes(tunnelHostname, dbId);
    const beforeMatches = baseline ? countPostedMatches(baseline, text) : 0;

    // ---- Compose phase — NO `uiautomator dump` until after submit ----
    // A dump collapses TikTok's comment composer and drops the input focus
    // (verified on box-1: inserting dumps between focus and type makes the text
    // never land). So we drive the proven tap sequence blind here and defer ALL
    // verification to the post-submit publication check, which is the
    // definitive, screenshot-independent signal anyway.
    await tap(tunnelHostname, dbId, COORDS.commentField); // focus → spawns EditText
    await sleep(TIMING.fieldFocus);
    await activateAdbKeyboard(tunnelHostname, dbId);       // shell-only, no uiautomator dump
    await tap(tunnelHostname, dbId, COORDS.commentField); // refocus after IME swap
    await sleep(TIMING.afterImeSwitch);
    await typeText(tunnelHostname, dbId, text);
    await sleep(TIMING.afterType);

    ttLog(dbId, "proof screenshot (composer + text, evidence only)");
    proof = await screenshot(tunnelHostname, dbId);
    await sleep(TIMING.beforeSubmit);

    await tap(tunnelHostname, dbId, COORDS.sendButton);
    await sleep(TIMING.postSubmit);

    // Gate 4 — confirm publication from the UI tree (never the screenshot): a
    // NEW list item matching our text must appear vs the pre-compose baseline.
    // "Cannot verify" is treated as failure.
    const confirmationShot = await verifySubmission(tunnelHostname, dbId, text, beforeMatches);

    // The comment is confirmed live — upgrade the proof from "composer with
    // text" (pre-submit) to the comment actually IN the list. This is the shot
    // operators need to trust the result at a glance; the composer shot stays
    // as the proof only when this capture fails.
    const liveShot = confirmationShot ?? await screenshot(tunnelHostname, dbId);
    if (liveShot.length > 0) proof = liveShot;

    // Best-effort: collapse the comments panel so the device returns to feed.
    await shellSafe(tunnelHostname, dbId, "input keyevent KEYCODE_BACK");

    const durationMs = Date.now() - start;
    ttLog(dbId, "postTikTokComment SUCCESS", {
      durationMs,
      sourceBytes: source.length,
      proofBytes: proof.length,
    });
    return { success: true, source, proof, durationMs };
  } catch (err) {
    const error = encodeJobError(err);
    const durationMs = Date.now() - start;
    ttLog(dbId, "postTikTokComment FAILED", {
      error,
      durationMs,
      sourceBytes: source.length,
      proofBytes: proof.length,
    });
    return { success: false, source, proof, error, durationMs };
  }
}

// ---------------------------------------------------------------------------
// Flow steps — each throws a typed JobError on an unrecoverable state
// ---------------------------------------------------------------------------

/**
 * Open the comments panel and PROVE it is up (an EditText or the "Comments"
 * sheet title is present).
 *
 * Critically, we tap the comment button ONCE per attempt and then *poll* for
 * the panel — never re-tapping while waiting. The panel-open dump can lag a few
 * seconds behind the animation, and an eager re-tap on an already-open panel
 * closes it again (the bug that made this look like the panel never opened).
 * Between attempts we dismiss any recognised interstitial (add-phone,
 * notification nudge).
 *
 * A blocker that surfaces mid-loop (auth wall after a redirect, consent
 * dialog) throws its own typed JobError — observed live: an expired session
 * redirected to the German "Willkommen zurück / Anmelden" re-login screen a
 * few seconds after the deep link, and the job burned 2 minutes tapping a
 * login wall before failing with a generic category that never tagged the
 * avatar. Otherwise throws retryable `app_not_ready` (nothing typed yet —
 * usually the video simply never loaded on this attempt).
 */
async function openCommentsPanel(
  tunnelHostname: string,
  dbId: string,
): Promise<void> {
  if (await ensureCommentsPanelOpen(tunnelHostname, dbId, { throwOnBlocker: true })) return;
  throw new JobError(
    "app_not_ready",
    "Comments panel never opened — the video did not load or the deep link landed off-target",
  );
}

/**
 * Best-effort: get the comments sheet open and return whether it is. Rotates
 * through the comment-icon Y candidates (its position drifts per video) and
 * polls after each tap — never re-tapping an already-open panel (that closes
 * it). Dismisses recognised interstitials. Reused by the initial open gate
 * (`throwOnBlocker` — a login/consent wall must fail the job with its own
 * category) and by the post-submit readback (best-effort only: the comment
 * may already be live, a late blocker must not overwrite that verdict).
 */
async function ensureCommentsPanelOpen(
  tunnelHostname: string,
  dbId: string,
  opts: { throwOnBlocker?: boolean } = {},
): Promise<boolean> {
  for (let attempt = 0; attempt < OPEN_PANEL_ATTEMPTS; attempt++) {
    const currentXml = await dumpUiXml(tunnelHostname, dbId);
    if (currentXml) {
      const nodes = parseUiNodes(currentXml);
      if (findCommentEditText(nodes) || isCommentsPanelOpen(nodes)) return true;
      if (opts.throwOnBlocker) {
        const blocker = detectBlockingState(currentXml);
        if (blocker) throw blocker;
      }
    }

    const target = COMMENT_BUTTON_CANDIDATES[attempt % COMMENT_BUTTON_CANDIDATES.length];
    await tap(tunnelHostname, dbId, target);

    for (let poll = 0; poll < PANEL_POLL_ATTEMPTS; poll++) {
      await sleep(TIMING.panelSettle);
      const xml = await dumpUiXml(tunnelHostname, dbId);
      if (!xml) continue;
      const nodes = parseUiNodes(xml);
      if (findCommentEditText(nodes) || isCommentsPanelOpen(nodes)) return true;

      if (opts.throwOnBlocker) {
        const blocker = detectBlockingState(xml);
        if (blocker) throw blocker;
      }

      const dismiss = findInterstitialDismiss(nodes);
      if (dismiss) {
        ttLog(dbId, "dismissing interstitial before composer", { x: dismiss.x, y: dismiss.y });
        await tap(tunnelHostname, dbId, dismiss);
      }
    }
  }
  return false;
}

// The just-posted comment can take longer than the initial post-submit sleep to
// render in the list (moderation/sort lag), so we poll generously. Widening
// this only trades a little latency for fewer false negatives — it can never
// create a false positive (the signal is still a NEW matching list item).
const SUBMIT_POLL_ATTEMPTS = 8;
const SUBMIT_POLL_INTERVAL_MS = 1200;

const OCR_MAX_ATTEMPTS = 2; // OCR is heavy — cap how many polls fall back to it

/**
 * Confirm the comment was actually published, from the device state only —
 * never optimistically.
 *
 * Two independent positive signals, in order of cost:
 *   1. Accessibility tree — a NEW list item matching our text vs the
 *      pre-compose baseline (`beforeMatches`). Foreign-safe (must be our text)
 *      and duplicate-safe (must be an increase over baseline).
 *   2. Screenshot OCR fallback — TikTok's compressed tree intermittently omits
 *      the freshly-posted row even when it's on screen. When the sheet is open
 *      and the tree didn't match, we OCR the screenshot. This runs ONLY after
 *      the tree has confirmed our text is no longer in the composer field, so
 *      an OCR hit can only be the posted comment in the list — a lagged frame
 *      yields a false negative (safe), never a false positive.
 *
 * Text still sitting in an `EditText` is a hard negative (`rate_limited`).
 * Leaving the TikTok foreground, or never getting a readable tree, is also a
 * failure. We never pass without one of the two positive signals.
 *
 * Returns the screenshot that carried the confirmation when one was taken
 * (OCR path) so the caller can persist it as the proof; `null` means the tree
 * confirmed and the caller should capture the live frame itself.
 */
async function verifySubmission(
  tunnelHostname: string,
  dbId: string,
  text: string,
  beforeMatches: number,
): Promise<Buffer | null> {
  let sawReadableTree = false;
  let ocrAttempts = 0;

  for (let attempt = 0; attempt < SUBMIT_POLL_ATTEMPTS; attempt++) {
    if (!(await isForegroundApp(tunnelHostname, dbId, TIKTOK_PACKAGE))) {
      const focus = await shellSafe(tunnelHostname, dbId, "dumpsys window | grep mCurrentFocus");
      if (focus?.message.includes(PERMISSION_CONTROLLER)) {
        throw new JobError(
          "consent_required",
          "A permission dialog appeared on submit — device needs a one-time manual ack",
        );
      }
      throw new JobError(
        "ui_unexpected",
        "TikTok left the foreground on submit — comment not confirmed",
      );
    }

    const nodes = await dumpUiNodes(tunnelHostname, dbId);
    if (nodes) {
      // Hard negative: our text still sits in the input field → not sent.
      if (editTextContains(nodes, text)) {
        throw new JobError(
          "rate_limited",
          "Comment not submitted — typed text still present in the input field (likely TikTok throttling or anti-spam)",
        );
      }

      const panelReadable = isCommentsPanelOpen(nodes) || findCommentEditText(nodes);
      if (panelReadable) sawReadableTree = true;

      // Signal 1 — tree shows a NEW matching list item vs baseline.
      if (countPostedMatches(nodes, text) > beforeMatches) {
        ttLog(dbId, "submission confirmed — our comment is in the list", { beforeMatches });
        return null;
      }

      // Signal 2 — field is cleared (checked above) and the sheet is on screen,
      // but the compressed tree didn't surface our row: OCR the screenshot.
      if (panelReadable && ocrAttempts < OCR_MAX_ATTEMPTS) {
        ocrAttempts++;
        const shot = await screenshot(tunnelHostname, dbId);
        if (await screenshotContainsText(shot, text)) {
          ttLog(dbId, "submission confirmed — our comment found via OCR", { ocrAttempts });
          return shot;
        }
      }
    }

    await sleep(SUBMIT_POLL_INTERVAL_MS);
  }

  // No positive signal from either the tree or OCR. Either the send tap missed
  // / the sheet closed (never a readable list), or TikTok accepted then silently
  // dropped it (anti-spam). Both are reported as FAILURES — never a false "done".
  throw new JobError(
    sawReadableTree ? "rate_limited" : "ui_unexpected",
    sawReadableTree
      ? "Comment not confirmed — our comment never appeared in the list (likely TikTok throttling / silent drop)"
      : "Could not confirm submission — comments list not readable after the send tap",
  );
}

/**
 * Toggle the on-screen pointer indicator. Helper kept for the calibration
 * CLI script (`scripts/tiktok-reply.ts --calibrate`).
 */
export async function setPointerLocation(
  tunnelHostname: string,
  dbId: string,
  enable: boolean,
): Promise<void> {
  await shell(tunnelHostname, dbId, `settings put system pointer_location ${enable ? 1 : 0}`);
}
