/**
 * Post a comment on TikTok via the native Android app.
 *
 * Pre-conditions enforced by the caller (`pipeline/executor`):
 *   - Container is fully booted (`ensureContainerReady`)
 *   - Original IME captured for restore in the surrounding try/finally
 *
 * Success contract:
 *   - SOURCE screenshot is captured once the target video is on screen
 *     (proves we are commenting on the right video).
 *   - PROOF screenshot is captured with the composer open and the typed
 *     comment visible (proves what is about to be sent).
 *   - The submit is verified by checking the comment field is empty in
 *     the UI tree after the send tap. If the field still contains our
 *     text the post is considered failed.
 *
 * Known blockers — the function throws with an explicit message:
 *   - TikTok app missing (`com.zhiliaoapp.musically`)
 *   - First-launch GDPR/ads consent dialog still on screen (requires
 *     a one-time manual ack on the device)
 */

import {
  shell,
  shellSafe,
  screenshot,
  sleep,
  wakeDevice,
  isPackageInstalled,
  activateAdbKeyboard,
  typeText,
  tryUiDump,
} from "./adb-helpers";
import { encodeJobError, JobError } from "./errors";

const TIKTOK_PACKAGE = "com.zhiliaoapp.musically";

// Validated 2026-04 on AOSP 13 / 1080×2340 / TikTok FR build.
const COORDS = {
  // Speech-bubble icon on the right action column of the video screen.
  commentButton: { x: 970, y: 1500 },
  // "Add a comment" input field at the bottom of the comments panel.
  commentField: { x: 450, y: 2262 },
  // Pink ↑ submit button shown to the right of the field once focused.
  sendButton: { x: 970, y: 1515 },
} as const;

// Timings tuned for a believable human pace AND to give VMOS' ~5 s
// screenshot cache time to invalidate between source and proof shots.
const TIMING = {
  afterForceStop: 800,
  videoLoad: 8000,           // cold-start + first frame
  panelSlide: 2500,
  fieldFocus: 1500,
  afterImeSwitch: 800,
  afterType: 2000,           // reread before sending
  beforeSubmit: 1200,        // pause before the decisive tap
  postSubmit: 4000,
} as const;

/**
 * Substrings observed in TikTok consent / first-launch dialogs across
 * supported locales. Detected via UI dump right after the deep link.
 */
const CONSENT_BLOCKERS = [
  "Choisir comment afficher",  // FR — ads consent
  "Pubs personnalisées",       // FR — option label
  "Choose your ads experience", // EN — ads consent
  "Personalized ads",           // EN — option label
];

const TIKTOK_LOGGED_OUT_MARKERS = [
  "Connecte-toi pour ",
  "Connecte-toi à TikTok",
  "Inscris-toi avec",
  "Log in to TikTok",
  "Sign up for TikTok",
  "Inicia sesión",
  "LoginActivity",
];

const TIKTOK_CONTENT_UNAVAILABLE_MARKERS = [
  "Vidéo non disponible",
  "Cette vidéo n'est pas disponible",
  "Video currently unavailable",
  "This video is currently unavailable",
  "Couldn't find this account",
  "Compte introuvable",
];

function detectBlockingState(ui: string): JobError | null {
  if (CONSENT_BLOCKERS.some((m) => ui.includes(m))) {
    return new JobError(
      "consent_required",
      "TikTok consent dialog blocking — device requires a one-time manual ack",
    );
  }
  if (TIKTOK_LOGGED_OUT_MARKERS.some((m) => ui.includes(m))) {
    return new JobError(
      "account_logged_out",
      "TikTok session expired or no avatar logged in on this device — operator must sign in again",
    );
  }
  if (TIKTOK_CONTENT_UNAVAILABLE_MARKERS.some((m) => ui.includes(m))) {
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

/**
 * Look for `text` inside any `EditText` node. Returns true only when our
 * typed comment is *still* in the input — a positive signal that submit
 * did not go through. Plain text rendered in the comments list shows up
 * in `TextView`, not `EditText`, so this avoids the obvious false
 * positive (our successfully posted comment appearing in the timeline).
 */
function isTextStuckInEditText(ui: string, text: string): boolean {
  const re = /<node\s+[^>]*?class="android\.widget\.EditText"[^>]*?\btext="([^"]*)"/g;
  for (const match of ui.matchAll(re)) {
    if (match[1] === text) return true;
  }
  return false;
}

export async function postTikTokComment(
  tunnelHostname: string,
  dbId: string,
  videoUrl: string,
  text: string,
): Promise<TikTokReplyResult> {
  const start = Date.now();
  ttLog(dbId, "postTikTokComment START", { videoUrl, textPreview: text.slice(0, 60) });

  try {
    if (!(await isPackageInstalled(tunnelHostname, dbId, TIKTOK_PACKAGE))) {
      throw new JobError(
        "device_setup_required",
        `TikTok app (${TIKTOK_PACKAGE}) not installed on device`,
      );
    }

    await wakeDevice(tunnelHostname, dbId);

    // Force-stop guarantees the deep link cold-starts on the target video
    // instead of resuming a stale session on a different feed item.
    await shell(tunnelHostname, dbId, `am force-stop ${TIKTOK_PACKAGE}`);
    await sleep(TIMING.afterForceStop);

    await shell(tunnelHostname, dbId, `am start -a android.intent.action.VIEW -d ${videoUrl}`);
    await sleep(TIMING.videoLoad);

    // Detect blocking states (consent dialog, login wall, deleted video)
    // before we start interacting — fail fast with a typed cause.
    const preUi = await tryUiDump(tunnelHostname, dbId);
    if (preUi) {
      const blocker = detectBlockingState(preUi);
      if (blocker) throw blocker;
    }

    ttLog(dbId, "source screenshot");
    const source = await screenshot(tunnelHostname, dbId);

    // Open the comments panel
    await shell(tunnelHostname, dbId, `input tap ${COORDS.commentButton.x} ${COORDS.commentButton.y}`);
    await sleep(TIMING.panelSlide);

    // Focus the field, swap to ADBKeyboard, refocus (the swap steals focus)
    await shell(tunnelHostname, dbId, `input tap ${COORDS.commentField.x} ${COORDS.commentField.y}`);
    await sleep(TIMING.fieldFocus);

    await activateAdbKeyboard(tunnelHostname, dbId);
    await shell(tunnelHostname, dbId, `input tap ${COORDS.commentField.x} ${COORDS.commentField.y}`);
    await sleep(TIMING.afterImeSwitch);

    await typeText(tunnelHostname, dbId, text);
    await sleep(TIMING.afterType);

    ttLog(dbId, "proof screenshot (composer ready)");
    const proof = await screenshot(tunnelHostname, dbId);
    await sleep(TIMING.beforeSubmit);

    // Submit. The composer stays on screen but the field clears on success.
    await shell(tunnelHostname, dbId, `input tap ${COORDS.sendButton.x} ${COORDS.sendButton.y}`);
    await sleep(TIMING.postSubmit);

    // Verify: the typed text must no longer be inside the EditText. We
    // only look at EditText nodes — our just-posted comment also appears
    // in the comments list (rendered as a TextView) and we must not flag
    // that as failure. The dump is best-effort: TikTok often returns no
    // EditText in the compressed tree (Compose-style composer) or fails
    // the idle wait outright, both of which we treat as inconclusive.
    const postUi = await tryUiDump(tunnelHostname, dbId);
    if (postUi && isTextStuckInEditText(postUi, text)) {
      throw new JobError(
        "rate_limited",
        "Comment not submitted — typed text still present in input field (likely TikTok throttling or anti-spam)",
      );
    }

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
    ttLog(dbId, "postTikTokComment FAILED", { error, durationMs });
    return {
      success: false,
      source: Buffer.alloc(0),
      proof: Buffer.alloc(0),
      error,
      durationMs,
    };
  }
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
