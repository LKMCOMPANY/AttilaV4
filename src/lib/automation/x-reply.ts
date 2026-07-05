/**
 * Post a reply on X/Twitter via the native Android app.
 *
 * Pre-conditions enforced by the caller (`pipeline/executor`):
 *   - Container is fully booted (`ensureContainerReady`)
 *   - Original IME captured for restore in the surrounding try/finally
 *
 * Success contract:
 *   - SOURCE screenshot is captured once the tweet detail activity is on
 *     screen (proves we are looking at the right post).
 *   - PROOF screenshot is captured with the composer open and the typed
 *     comment visible (proves what is about to be sent).
 *   - The post is considered successful only when, after tapping the post
 *     button, focus returns to `TweetDetailActivity`. Any other state
 *     (composer still up, error toast, app crash) throws.
 */

import {
  shell,
  screenshot,
  sleep,
  wakeDevice,
  isPackageInstalled,
  grantAppPermissions,
  activateAdbKeyboard,
  typeText,
  getCurrentFocus,
  waitForSystemReady,
  relaunchUntilFocus,
  androidDeepLink,
  dumpUiXml,
  parseUiNodes,
  editTextContains,
} from "./adb-helpers";
import { encodeJobError, JobError } from "./errors";

const X_PACKAGE = "com.twitter.android";
const TWEET_DETAIL_FOCUS_HINT = "TweetDetailActivity";
const COMPOSER_FOCUS_HINT = "ComposerActivity";

/**
 * Pre-granted so X never raises a focus-stealing runtime permission dialog
 * (photos/camera/notifications) mid-reply. Best-effort — see
 * `grantAppPermissions`.
 */
const X_PERMISSIONS = [
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
] as const;

/**
 * Blocking states detected from the UI tree right after the tweet loads.
 * Order matters: a "logged out" page also contains generic content, so we
 * check explicit auth markers first. Patterns kept short and multilingual
 * (FR/EN/ES seen in the wild on our avatar accounts).
 */
const X_LOGGED_OUT_MARKERS = [
  "Connecte-toi",
  "Crée un compte",
  "Sign in to X",
  "Sign in to Twitter",
  "Log in to X",
  "Inicia sesión",
  "LoginActivity",
  "OnboardingActivity",
  "SsoActivity",
];

const X_CONTENT_UNAVAILABLE_MARKERS = [
  "This Post is unavailable",
  "This Tweet is unavailable",
  "Cette publication n'est pas disponible",
  "Ce post n'est pas disponible",
  "Ce Tweet n'est pas disponible",
  "Hmm...this page doesn't exist",
  "Cette page n'existe pas",
  "Account suspended",
  "compte a été suspendu",
];

// X's full-screen network-error state ("Something went wrong. Try reloading."
// / « Un problème est survenu. Réessayez. »). Same failure mode as TikTok's
// (see tiktok-reply): a dead device proxy or blocked exit IP — the app
// foregrounds but no content loads, and job retries cannot help. Compound
// match (error phrase + reload affordance) to avoid false positives.
const X_NETWORK_ERROR_PHRASES = [
  "Something went wrong",
  "Un problème est survenu",
  "Une erreur s'est produite",
  "Algo salió mal",
  "Etwas ist schiefgelaufen",
];
const X_NETWORK_RETRY_LABELS = [
  "Try reloading",
  "Try again",
  "Retry",
  "Réessayer",
  "Reintentar",
  "Erneut versuchen",
];

// X's tweet-detail content-error state has NO retry button (seen live 07/2026:
// a job proof showed "Cannot retrieve posts at this time. Please try again
// later." on a dead-proxy device — and the job was wrongly marked done). These
// phrases never appear in a healthy thread, so they match standalone.
const X_CONTENT_ERROR_MARKERS = [
  "Cannot retrieve posts at this time",
  "Impossible de récupérer les posts",
  "Impossible de récupérer les Tweets",
  "No se pueden recuperar las publicaciones",
];

function isNetworkErrorScreen(ui: string): boolean {
  if (X_CONTENT_ERROR_MARKERS.some((m) => ui.includes(m))) return true;
  return (
    X_NETWORK_ERROR_PHRASES.some((m) => ui.includes(m)) &&
    X_NETWORK_RETRY_LABELS.some((m) => ui.includes(m))
  );
}

function detectBlockingState(ui: string): JobError | null {
  if (X_LOGGED_OUT_MARKERS.some((m) => ui.includes(m))) {
    return new JobError(
      "account_logged_out",
      "X session expired or no avatar logged in on this device — operator must sign in again",
    );
  }
  if (isNetworkErrorScreen(ui)) {
    return new JobError(
      "network_unavailable",
      "X cannot load any content on this device — its proxy is down or the exit IP is blocked; check/replace the device proxy",
    );
  }
  if (X_CONTENT_UNAVAILABLE_MARKERS.some((m) => ui.includes(m))) {
    return new JobError(
      "content_unavailable",
      "Tweet is deleted, private, suspended, or geo-blocked — skip this post",
    );
  }
  return null;
}

const COORDS = {
  // Reply field hint at the bottom of the tweet detail screen — opens
  // either the inline composer (stays inside TweetDetailActivity) or
  // the fullscreen ComposerActivity depending on the device/account.
  replyField: { x: 540, y: 2277 },
  // Active "Répondre/Reply" button when the composer renders inline as
  // a fragment of TweetDetailActivity (bottom-right of the composer row).
  postButtonInline: { x: 947, y: 2220 },
  // Active "Répondre/Reply" button when the composer takes over the
  // screen (ComposerActivity) — top-right of the screen.
  postButtonFullscreen: { x: 947, y: 165 },
} as const;

// Timings tuned for a believable human pace AND to give VMOS' ~5 s
// screenshot cache time to invalidate between source and proof shots.
// `screenshot()` already retries on stale hashes; these durations make the
// whole flow look natural even when the cache cooperates.
const TIMING = {
  afterForceStop: 800,
  systemReadyMs: 30_000,     // wait for launcher to own mCurrentFocus after boot
  beforeSourceShot: 1800,    // simulate reading the tweet
  composerOpen: 1500,
  afterImeSwitch: 800,
  afterType: 2000,           // reread before sending
  beforeSubmit: 1200,        // pause before the decisive tap
  postSubmit: 4000,
  focusOpenTimeoutMs: 15_000, // per deep-link attempt
  launchAttempts: 3,          // re-fire the deep link up to 3× before failing
} as const;

export interface ReplyResult {
  success: boolean;
  source: Buffer;
  proof: Buffer;
  error?: string;
  durationMs: number;
}

function xLog(dbId: string, step: string, data?: Record<string, unknown>) {
  console.log(`[X-Reply][${dbId}] ${step}`, data ? JSON.stringify(data) : "");
}

export async function postReply(
  tunnelHostname: string,
  dbId: string,
  tweetUrl: string,
  text: string,
): Promise<ReplyResult> {
  const start = Date.now();
  xLog(dbId, "postReply START", { tweetUrl, textPreview: text.slice(0, 60) });

  // Captured progressively so the catch can surface them as proofs even on
  // partial flows (e.g. when the submit verification fails, we still want
  // the source + proof shots for operator debugging).
  let source: Buffer = Buffer.alloc(0);
  let proof: Buffer = Buffer.alloc(0);

  try {
    if (!tweetUrl || !tweetUrl.trim()) {
      throw new JobError(
        "ui_unexpected",
        "Empty tweet URL — pipeline produced a job without a deep link target",
      );
    }

    if (!(await isPackageInstalled(tunnelHostname, dbId, X_PACKAGE))) {
      throw new JobError(
        "device_setup_required",
        `X app (${X_PACKAGE}) not installed on device`,
      );
    }

    // Pre-grant so a runtime permission dialog never blocks the reply flow.
    await grantAppPermissions(tunnelHostname, dbId, X_PACKAGE, X_PERMISSIONS);

    await wakeDevice(tunnelHostname, dbId);

    // Wait for the window system to settle onto a real focused window before
    // deep-linking — on a loaded host `boot_completed` fires while services
    // are still starting and the launch gets swallowed (see tiktok-reply).
    await waitForSystemReady(tunnelHostname, dbId, TIMING.systemReadyMs);

    // Force-stop X to guarantee a clean entry point — avoids inheriting a
    // stale composer or an unrelated tweet from a prior interrupted job.
    await shell(tunnelHostname, dbId, `am force-stop ${X_PACKAGE}`);
    await sleep(TIMING.afterForceStop);

    // Open the tweet via deep link and confirm the tweet-detail screen owns
    // the focus, re-firing the (cheap) intent if a loaded box swallowed the
    // first launch — cheaper than failing the job and cold-restarting (~120s).
    // `androidDeepLink` canonicalises + quotes the url (drops any `?…` query
    // that would split the shell command on `&`).
    const deepLink = androidDeepLink(tweetUrl);
    const opened = await relaunchUntilFocus(
      tunnelHostname,
      dbId,
      deepLink,
      TWEET_DETAIL_FOCUS_HINT,
      {
        attempts: TIMING.launchAttempts,
        perAttemptMs: TIMING.focusOpenTimeoutMs,
        onRetry: (n) => xLog(dbId, `tweet detail not open — re-firing deep link (attempt ${n + 1})`),
      },
    );
    if (!opened) {
      // Either the app is stuck on a login wall / error page, or the launch
      // never took. Classify a blocker; otherwise fail retryable (pre-compose).
      const ui = await dumpUiXml(tunnelHostname, dbId);
      const blocker = ui ? detectBlockingState(ui) : null;
      if (blocker) throw blocker;
      throw new JobError(
        "app_not_ready",
        `Tweet detail did not open after ${TIMING.launchAttempts} deep-link attempts`,
      );
    }
    await sleep(TIMING.beforeSourceShot); // give content a beat to render

    // Detect blocking states (login wall, deleted post, suspended account)
    // before we start interacting — better to fail fast with a clear cause.
    const preUi = await dumpUiXml(tunnelHostname, dbId);
    if (preUi) {
      const blocker = detectBlockingState(preUi);
      if (blocker) throw blocker;
    }

    xLog(dbId, "source screenshot");
    source = await screenshot(tunnelHostname, dbId);

    // Open composer. Depending on the device / account / build, this either
    // expands an inline composer fragment inside TweetDetailActivity OR
    // launches the standalone ComposerActivity full-screen. Both are valid
    // entry points; the only difference for us is the position of the
    // submit button — we detect the mode and pick the right coords.
    await shell(tunnelHostname, dbId, `input tap ${COORDS.replyField.x} ${COORDS.replyField.y}`);
    await sleep(TIMING.composerOpen);

    const composerMode = await detectComposerMode(tunnelHostname, dbId);
    xLog(dbId, "composer mode detected", { mode: composerMode });

    // Switch to ADBKeyboard so `am broadcast -a ADB_INPUT_TEXT` is honored.
    // The X app loses focus during the IME swap so we re-tap the field after.
    await activateAdbKeyboard(tunnelHostname, dbId);
    await shell(tunnelHostname, dbId, `input tap ${COORDS.replyField.x} ${COORDS.replyField.y}`);
    await sleep(TIMING.afterImeSwitch);

    await typeText(tunnelHostname, dbId, text);
    await sleep(TIMING.afterType);

    // Gate — the text must actually be sitting in the composer's EditText
    // before we tap send. Unlike TikTok, X tolerates uiautomator dumps with
    // the composer open (verified live 07/2026: the dump returns the
    // `tweet_text` EditText with the typed content and the composer keeps
    // focus), so we can check positively. Catches dead-IME / mistargeted-tap
    // flows that previously tapped send on an EMPTY composer and were still
    // reported done (8/8 of yesterday's "done" tweets were never published).
    const composerXml = await dumpUiXml(tunnelHostname, dbId);
    if (!composerXml || !editTextContains(parseUiNodes(composerXml), text)) {
      throw new JobError(
        "app_not_ready",
        "Typed text never landed in the X composer — IME or focus failure before submit",
      );
    }

    xLog(dbId, "proof screenshot (composer ready)");
    proof = await screenshot(tunnelHostname, dbId);
    await sleep(TIMING.beforeSubmit);

    // Submit using the coords for the current composer mode.
    const submit = composerMode === "fullscreen"
      ? COORDS.postButtonFullscreen
      : COORDS.postButtonInline;
    await shell(tunnelHostname, dbId, `input tap ${submit.x} ${submit.y}`);
    await sleep(TIMING.postSubmit);

    // Verify the send actually went through — two independent signals:
    //   1. No EditText may still hold our text. If it does, the submit tap
    //      did not fire (rate limit, disabled button, dead network). NOT
    //      auto-retryable: X can park the reply in drafts/outbox and flush it
    //      later, so a blind retry risks a double-post.
    //   2. Focus must be back on the tweet detail without the composer.
    // A posted reply shows as a TextView in the thread, never an EditText, so
    // signal 1 cannot false-positive on success. TikHub's deferred sweep
    // (`verification` column) remains the independent off-device arbiter.
    const postXml = await dumpUiXml(tunnelHostname, dbId);
    if (postXml && editTextContains(parseUiNodes(postXml), text)) {
      throw new JobError(
        "ui_unexpected",
        "Submit tap did not send — the reply text is still in the composer (rate limit or dead network)",
      );
    }
    const focus = await getCurrentFocus(tunnelHostname, dbId);
    if (!focus.includes(TWEET_DETAIL_FOCUS_HINT) || focus.includes(COMPOSER_FOCUS_HINT)) {
      throw new JobError(
        "ui_unexpected",
        `Post not submitted — focus did not return to tweet detail (mode=${composerMode}, current=${focus})`,
      );
    }

    // Upgrade the proof from "composer with text" (pre-submit) to the thread
    // AFTER the send, so the operator sees the actual posted state, not a shot
    // that merely proves we typed. Best-effort — keep the composer shot if this
    // capture fails.
    const postedShot = await screenshot(tunnelHostname, dbId).catch(() => Buffer.alloc(0));
    if (postedShot.length > 0) proof = postedShot;

    const durationMs = Date.now() - start;
    xLog(dbId, "postReply SUCCESS", {
      durationMs,
      mode: composerMode,
      sourceBytes: source.length,
      proofBytes: proof.length,
    });
    return { success: true, source, proof, durationMs };
  } catch (err) {
    const error = encodeJobError(err);
    const durationMs = Date.now() - start;
    // Honest failure evidence: replace the pre-submit composer shot with the
    // actual end state (error page, stuck composer, blocker) so a failed job
    // never shows a success-looking screenshot. Best-effort.
    const endState = await screenshot(tunnelHostname, dbId).catch(() => Buffer.alloc(0));
    if (endState.length > 0) proof = endState;
    xLog(dbId, "postReply FAILED", {
      error,
      durationMs,
      sourceBytes: source.length,
      proofBytes: proof.length,
    });
    return {
      success: false,
      source,
      proof,
      error,
      durationMs,
    };
  }
}

/**
 * Inspect the current window focus to decide which submit-button coords
 * to use. The X app sometimes opens a compact composer fragment inside
 * TweetDetailActivity, sometimes the full-screen ComposerActivity — the
 * positions of the active "Répondre" button differ between the two.
 *
 * Treats missing/empty focus as `inline` — that's the conservative choice
 * because the inline coord (947, 2220) overlaps the bottom action row in
 * fullscreen mode, while the fullscreen coord (947, 165) sits in the top
 * status area in inline mode (no-op tap).
 */
async function detectComposerMode(
  tunnelHostname: string,
  dbId: string,
): Promise<"inline" | "fullscreen"> {
  const focus = await getCurrentFocus(tunnelHostname, dbId);
  return focus.includes(COMPOSER_FOCUS_HINT) ? "fullscreen" : "inline";
}
