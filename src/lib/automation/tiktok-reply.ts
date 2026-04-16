/**
 * Post a comment on TikTok via ADB on VMOS containers.
 *
 * Requires the TikTok app (com.zhiliaoapp.musically) installed and logged in.
 * Uses calibrated coordinates for the comment button, text field, and send button.
 */

import {
  shell,
  screenshot,
  sleep,
  wakeDevice,
  ensureAdbKeyboard,
  typeText,
  restoreGboard,
} from "./adb-helpers";

const COORDS = {
  commentButton: { x: 985, y: 1425 },
  commentField: { x: 200, y: 2290 },
  sendButton: { x: 970, y: 1515 },
};

const TIMING = {
  videoLoad: 8000,
  panelSlide: 3000,
  afterTapField: 1500,
  afterType: 1000,
  afterSend: 5000,
};

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

async function hasTikTokApp(boxHost: string, dbId: string): Promise<boolean> {
  const result = await shell(boxHost, dbId, "pm list packages | grep musically");
  const found = result.message.includes("com.zhiliaoapp.musically");
  ttLog(dbId, `hasTikTokApp: ${found}`, { raw: result.message.trim() });
  return found;
}

export async function postTikTokComment(
  boxHost: string,
  dbId: string,
  videoUrl: string,
  text: string,
): Promise<TikTokReplyResult> {
  const start = Date.now();

  ttLog(dbId, "postTikTokComment START", { boxHost, videoUrl, textPreview: text.slice(0, 60) });

  try {
    const hasApp = await hasTikTokApp(boxHost, dbId);
    if (!hasApp) {
      throw new Error("TikTok app (com.zhiliaoapp.musically) not installed");
    }

    // --- Step 1: Wake device ---
    ttLog(dbId, "step 1: wake device");
    await wakeDevice(boxHost, dbId);

    // --- Step 2: Open video via deep link ---
    ttLog(dbId, "step 2: open video via deep link", { url: videoUrl });
    await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${videoUrl}`);
    await sleep(TIMING.videoLoad);

    // --- Step 3: Screenshot source (video loaded) ---
    ttLog(dbId, "step 3: screenshot source");
    const source = await screenshot(boxHost, dbId);

    // --- Step 4: Tap comment button to open panel ---
    ttLog(dbId, "step 4: tap comment button", { coords: COORDS.commentButton });
    await shell(boxHost, dbId, `input tap ${COORDS.commentButton.x} ${COORDS.commentButton.y}`);
    await sleep(TIMING.panelSlide);

    // --- Step 5: Tap comment field to get keyboard ---
    ttLog(dbId, "step 5: tap comment field", { coords: COORDS.commentField });
    await shell(boxHost, dbId, `input tap ${COORDS.commentField.x} ${COORDS.commentField.y}`);
    await sleep(TIMING.afterTapField);

    // --- Step 6: Activate ADBKeyboard ---
    ttLog(dbId, "step 6: activate ADBKeyboard");
    const kbReady = await ensureAdbKeyboard(boxHost, dbId);
    if (!kbReady) throw new Error("ADBKeyboard activation failed");

    // --- Step 7: Re-tap field after IME switch (TikTok loses focus) ---
    ttLog(dbId, "step 7: re-tap comment field after IME switch");
    await shell(boxHost, dbId, `input tap ${COORDS.commentField.x} ${COORDS.commentField.y}`);
    await sleep(500);

    // --- Step 8: Type text ---
    ttLog(dbId, "step 8: broadcast text input", { textLength: text.length });
    const typed = await typeText(boxHost, dbId, text);
    if (!typed) throw new Error("Text broadcast failed");
    await sleep(TIMING.afterType);

    // --- Step 9: Tap send button ---
    ttLog(dbId, "step 9: tap send button", { coords: COORDS.sendButton });
    await shell(boxHost, dbId, `input tap ${COORDS.sendButton.x} ${COORDS.sendButton.y}`);
    await sleep(TIMING.afterSend);

    // --- Step 10: Screenshot proof (comment should be visible in panel) ---
    ttLog(dbId, "step 10: screenshot proof");
    const proof = await screenshot(boxHost, dbId);

    // --- Step 11: Restore Gboard + close panel ---
    ttLog(dbId, "step 11: restore Gboard + back");
    await restoreGboard(boxHost, dbId);
    await shell(boxHost, dbId, "input keyevent KEYCODE_BACK");

    ttLog(dbId, "postTikTokComment SUCCESS", {
      durationMs: Date.now() - start,
      sourceBytes: source.length,
      proofBytes: proof.length,
    });
    return { success: true, source, proof, durationMs: Date.now() - start };
  } catch (err) {
    await restoreGboard(boxHost, dbId);
    const error = err instanceof Error ? err.message : String(err);
    ttLog(dbId, "postTikTokComment FAILED", { error, durationMs: Date.now() - start });
    return {
      success: false,
      source: Buffer.alloc(0),
      proof: Buffer.alloc(0),
      error,
      durationMs: Date.now() - start,
    };
  }
}

export async function setPointerLocation(
  boxHost: string,
  dbId: string,
  enable: boolean,
): Promise<void> {
  await shell(boxHost, dbId, `settings put system pointer_location ${enable ? 1 : 0}`);
}
