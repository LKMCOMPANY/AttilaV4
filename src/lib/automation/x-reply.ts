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
  activateAdbKeyboard,
  typeText,
  getCurrentFocus,
  waitForFocus,
  tryUiDump,
} from "./adb-helpers";
import { encodeJobError, JobError } from "./errors";

const X_PACKAGE = "com.twitter.android";
const TWEET_DETAIL_FOCUS_HINT = "TweetDetailActivity";

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

function detectBlockingState(ui: string): JobError | null {
  if (X_LOGGED_OUT_MARKERS.some((m) => ui.includes(m))) {
    return new JobError(
      "account_logged_out",
      "X session expired or no avatar logged in on this device — operator must sign in again",
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
  // Reply field at the bottom of the tweet detail screen, opens composer.
  replyField: { x: 540, y: 2277 },
  // Active "Répondre/Reply" button inside the composer.
  postButton: { x: 947, y: 2220 },
} as const;

// Timings tuned for a believable human pace AND to give VMOS' ~5 s
// screenshot cache time to invalidate between source and proof shots.
// `screenshot()` already retries on stale hashes; these durations make the
// whole flow look natural even when the cache cooperates.
const TIMING = {
  afterForceStop: 800,
  beforeSourceShot: 1800,    // simulate reading the tweet
  composerOpen: 1500,
  afterImeSwitch: 800,
  afterType: 2000,           // reread before sending
  beforeSubmit: 1200,        // pause before the decisive tap
  postSubmit: 4000,
  focusOpenTimeoutMs: 15_000,
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

  try {
    if (!(await isPackageInstalled(tunnelHostname, dbId, X_PACKAGE))) {
      throw new JobError(
        "device_setup_required",
        `X app (${X_PACKAGE}) not installed on device`,
      );
    }

    await wakeDevice(tunnelHostname, dbId);

    // Force-stop X to guarantee a clean entry point — avoids inheriting a
    // stale composer or an unrelated tweet from a prior interrupted job.
    await shell(tunnelHostname, dbId, `am force-stop ${X_PACKAGE}`);
    await sleep(TIMING.afterForceStop);

    // Open the tweet via deep link — Android routes x.com URLs to the app.
    await shell(tunnelHostname, dbId, `am start -a android.intent.action.VIEW -d ${tweetUrl}`);

    try {
      await waitForFocus(tunnelHostname, dbId, TWEET_DETAIL_FOCUS_HINT, TIMING.focusOpenTimeoutMs);
    } catch {
      // The intent never reached the tweet detail screen. Either the app is
      // stuck on a login wall or the URL routes to an error page.
      const ui = await tryUiDump(tunnelHostname, dbId);
      const blocker = ui ? detectBlockingState(ui) : null;
      if (blocker) throw blocker;
      throw new JobError(
        "ui_unexpected",
        `Tweet detail did not open within ${TIMING.focusOpenTimeoutMs / 1000}s after deep link`,
      );
    }
    await sleep(TIMING.beforeSourceShot); // give content a beat to render

    // Detect blocking states (login wall, deleted post, suspended account)
    // before we start interacting — better to fail fast with a clear cause.
    const preUi = await tryUiDump(tunnelHostname, dbId);
    if (preUi) {
      const blocker = detectBlockingState(preUi);
      if (blocker) throw blocker;
    }

    xLog(dbId, "source screenshot");
    const source = await screenshot(tunnelHostname, dbId);

    // Open composer
    await shell(tunnelHostname, dbId, `input tap ${COORDS.replyField.x} ${COORDS.replyField.y}`);
    await sleep(TIMING.composerOpen);

    // Switch to ADBKeyboard so `am broadcast -a ADB_INPUT_TEXT` is honored.
    // The X app loses focus during the IME swap so we re-tap the field after.
    await activateAdbKeyboard(tunnelHostname, dbId);
    await shell(tunnelHostname, dbId, `input tap ${COORDS.replyField.x} ${COORDS.replyField.y}`);
    await sleep(TIMING.afterImeSwitch);

    await typeText(tunnelHostname, dbId, text);
    await sleep(TIMING.afterType);

    xLog(dbId, "proof screenshot (composer ready)");
    const proof = await screenshot(tunnelHostname, dbId);
    await sleep(TIMING.beforeSubmit);

    // Submit
    await shell(tunnelHostname, dbId, `input tap ${COORDS.postButton.x} ${COORDS.postButton.y}`);
    await sleep(TIMING.postSubmit);

    // Verify: composer must close — focus returns to tweet detail. Anything
    // else (composer still up, dialog, app crash) means the post did not go
    // through (text too long, rate limit, network…).
    const focus = await getCurrentFocus(tunnelHostname, dbId);
    if (!focus.includes(TWEET_DETAIL_FOCUS_HINT)) {
      throw new JobError(
        "ui_unexpected",
        `Post not submitted — focus did not return to tweet detail (current=${focus})`,
      );
    }

    const durationMs = Date.now() - start;
    xLog(dbId, "postReply SUCCESS", {
      durationMs,
      sourceBytes: source.length,
      proofBytes: proof.length,
    });
    return { success: true, source, proof, durationMs };
  } catch (err) {
    const error = encodeJobError(err);
    const durationMs = Date.now() - start;
    xLog(dbId, "postReply FAILED", { error, durationMs });
    return {
      success: false,
      source: Buffer.alloc(0),
      proof: Buffer.alloc(0),
      error,
      durationMs,
    };
  }
}
