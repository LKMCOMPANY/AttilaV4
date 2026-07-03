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
  waitForForegroundApp,
  isForegroundApp,
  activateAdbKeyboard,
  typeText,
  tap,
  dumpUiXml,
  dumpUiNodes,
  findCommentEditText,
  editTextContains,
  findInterstitialDismiss,
  isCommentsPanelOpen,
  countPostedMatches,
} from "./adb-helpers";
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
  foregroundTimeoutMs: 20_000, // cold start to MainActivity (~4s observed) + margin
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
  if (LOGGED_OUT_MARKERS.some((m) => uiXml.includes(m))) {
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

    // Force-stop guarantees the deep link cold-starts on the target video
    // instead of resuming a stale session on a different feed item.
    await shell(tunnelHostname, dbId, `am force-stop ${TIKTOK_PACKAGE}`);
    await sleep(TIMING.afterForceStop);

    // Route the deep link explicitly to TikTok (the trailing package). Without
    // it the intent occasionally resolves to the For-You feed or an ad instead
    // of the target video, and every subsequent tap then acts on the wrong
    // screen. Verified on box-1 (07/2026): the package qualifier lands on the
    // exact video detail.
    await shell(
      tunnelHostname,
      dbId,
      `am start -a android.intent.action.VIEW -d ${videoUrl} ${TIKTOK_PACKAGE}`,
    );

    // Gate 1 — TikTok must actually own the foreground. Without this the old
    // flow tapped the launcher / a splash / a notification shade and still
    // reported success.
    await ensureTikTokForeground(tunnelHostname, dbId);
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
    await verifySubmission(tunnelHostname, dbId, text, beforeMatches);

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
 * Wait for TikTok to own the foreground after the deep link. On timeout, dump
 * once to classify *why* (login wall, consent, unavailable) before giving up
 * with a generic `ui_unexpected`.
 */
async function ensureTikTokForeground(
  tunnelHostname: string,
  dbId: string,
): Promise<void> {
  try {
    await waitForForegroundApp(
      tunnelHostname,
      dbId,
      TIKTOK_PACKAGE,
      TIMING.foregroundTimeoutMs,
    );
  } catch {
    const xml = await dumpUiXml(tunnelHostname, dbId);
    const blocker = xml ? detectBlockingState(xml) : null;
    if (blocker) throw blocker;
    throw new JobError(
      "ui_unexpected",
      `TikTok did not reach the foreground within ${TIMING.foregroundTimeoutMs / 1000}s of the deep link`,
    );
  }
}

/**
 * Open the comments panel and PROVE it is up (an EditText or the "Comments"
 * sheet title is present).
 *
 * Critically, we tap the comment button ONCE per attempt and then *poll* for
 * the panel — never re-tapping while waiting. The panel-open dump can lag a few
 * seconds behind the animation, and an eager re-tap on an already-open panel
 * closes it again (the bug that made this look like the panel never opened).
 * Between attempts we dismiss any recognised interstitial (add-phone,
 * notification nudge). Throws `ui_unexpected` if the panel never opens — the
 * exact state the old flow silently reported as a posted comment.
 */
async function openCommentsPanel(
  tunnelHostname: string,
  dbId: string,
): Promise<void> {
  if (await ensureCommentsPanelOpen(tunnelHostname, dbId)) return;
  throw new JobError(
    "ui_unexpected",
    "Comments panel never opened — deep link may have landed off-target or an unknown dialog is blocking",
  );
}

/**
 * Best-effort: get the comments sheet open and return whether it is. Rotates
 * through the comment-icon Y candidates (its position drifts per video) and
 * polls after each tap — never re-tapping an already-open panel (that closes
 * it). Dismisses recognised interstitials. Reused by the initial open gate and
 * by the post-submit readback (which must re-open the sheet after TikTok
 * collapses back to the opaque video surface).
 */
async function ensureCommentsPanelOpen(
  tunnelHostname: string,
  dbId: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < OPEN_PANEL_ATTEMPTS; attempt++) {
    const current = await dumpUiNodes(tunnelHostname, dbId);
    if (current && (findCommentEditText(current) || isCommentsPanelOpen(current))) return true;

    const target = COMMENT_BUTTON_CANDIDATES[attempt % COMMENT_BUTTON_CANDIDATES.length];
    await tap(tunnelHostname, dbId, target);

    for (let poll = 0; poll < PANEL_POLL_ATTEMPTS; poll++) {
      await sleep(TIMING.panelSettle);
      const nodes = await dumpUiNodes(tunnelHostname, dbId);
      if (!nodes) continue;
      if (findCommentEditText(nodes) || isCommentsPanelOpen(nodes)) return true;

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

/**
 * Confirm the comment was actually published — from the UI tree only, never
 * the screenshot (which can lag).
 *
 * The single positive signal is a NEW list item matching our text vs the
 * pre-compose baseline (`beforeMatches`). This is both:
 *   - foreign-safe — a stranger's comment bumping the panel count doesn't match
 *     our text, so it never counts as ours;
 *   - duplicate-safe — if the avatar had already posted this exact text, that
 *     copy is in the baseline, so only a genuinely new copy passes.
 *
 * Text still sitting in an `EditText` is a hard negative (`rate_limited`).
 * Leaving the TikTok foreground, or never getting a readable tree, is also
 * failure — we never pass optimistically. `countBefore/After` are logged as
 * diagnostics only, never as the deciding signal (a count bump alone can come
 * from another user's comment).
 */
async function verifySubmission(
  tunnelHostname: string,
  dbId: string,
  text: string,
  beforeMatches: number,
): Promise<void> {
  let sawReadableTree = false;

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
      if (isCommentsPanelOpen(nodes) || findCommentEditText(nodes)) sawReadableTree = true;

      // The ONLY success signal: a NEW list item matching OUR text vs baseline.
      // Foreign-safe (must be our text) and duplicate-safe (must be an
      // increase) — a bare comment-count bump is deliberately NOT trusted,
      // because on a busy video a stranger's comment can bump it while ours is
      // silently dropped. TikTok echoes the just-posted comment at the top of
      // the still-open sheet, which is the window this poll captures.
      if (countPostedMatches(nodes, text) > beforeMatches) {
        ttLog(dbId, "submission confirmed — our comment is in the list", { beforeMatches });
        return;
      }
    }

    await sleep(SUBMIT_POLL_INTERVAL_MS);
  }

  // No new matching comment appeared in the open sheet. Either the send tap
  // missed / the sheet closed (we never saw a readable comments list), or
  // TikTok accepted then silently dropped it (anti-spam). Both are non-terminal
  // and, crucially, are reported as FAILURES — never an optimistic "done".
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
