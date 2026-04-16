/**
 * Post a comment on TikTok via ADB on VMOS containers.
 *
 * Requires the TikTok app (com.zhiliaoapp.musically) installed and logged in.
 * Uses calibrated coordinates for the comment button, text field, and send button.
 */

import {
  ADBKEYBOARD_IME,
  GBOARD_IME,
  shell,
  screenshot,
  sleep,
  escapeShellText,
  wakeDevice,
} from "./adb-helpers";

const COORDS = {
  commentButton: { x: 985, y: 1425 },
  commentField: { x: 200, y: 2290 },
  sendButton: { x: 970, y: 1515 },
};

const TIMING = {
  videoLoad: 8000,
  panelSlide: 3000,
  keyboardAppear: 1000,
  imeSwitch: 1000,
  afterType: 1000,
  afterSend: 4000,
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

async function isAdbKeyboardEnabled(boxHost: string, dbId: string): Promise<boolean> {
  const result = await shell(boxHost, dbId, "ime list -s");
  const enabled = result.message.includes("com.android.adbkeyboard");
  ttLog(dbId, `isAdbKeyboardEnabled: ${enabled}`, { raw: result.message.trim() });
  return enabled;
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

    const adbkEnabled = await isAdbKeyboardEnabled(boxHost, dbId);
    if (!adbkEnabled) {
      ttLog(dbId, "step 1: enabling ADBKeyboard (was disabled)");
      await shell(boxHost, dbId, `ime enable ${ADBKEYBOARD_IME}`);
    }

    ttLog(dbId, "step 2: wake device");
    await wakeDevice(boxHost, dbId);

    ttLog(dbId, "step 3: open video via deep link", { url: videoUrl });
    await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${videoUrl}`);
    await sleep(TIMING.videoLoad);

    ttLog(dbId, "step 4: screenshot source");
    const source = await screenshot(boxHost, dbId);

    ttLog(dbId, "step 5: tap comment button", { coords: COORDS.commentButton });
    await shell(boxHost, dbId, `input tap ${COORDS.commentButton.x} ${COORDS.commentButton.y}`);
    await sleep(TIMING.panelSlide);

    ttLog(dbId, "step 6: tap comment field", { coords: COORDS.commentField });
    await shell(boxHost, dbId, `input tap ${COORDS.commentField.x} ${COORDS.commentField.y}`);
    await sleep(TIMING.keyboardAppear);

    ttLog(dbId, "step 7: set ADBKeyboard + re-tap field");
    await shell(boxHost, dbId, `ime set ${ADBKEYBOARD_IME}`);
    await shell(boxHost, dbId, `input tap ${COORDS.commentField.x} ${COORDS.commentField.y}`);
    await sleep(TIMING.imeSwitch);

    ttLog(dbId, "step 8: broadcast text input", { textLength: text.length });
    await shell(boxHost, dbId, `am broadcast -a ADB_INPUT_TEXT --es msg "${escapeShellText(text)}"`);
    await sleep(TIMING.afterType);

    ttLog(dbId, "step 9: tap send button", { coords: COORDS.sendButton });
    await shell(boxHost, dbId, `input tap ${COORDS.sendButton.x} ${COORDS.sendButton.y}`);
    await sleep(TIMING.afterSend);

    ttLog(dbId, "step 10: screenshot proof");
    const proof = await screenshot(boxHost, dbId);

    ttLog(dbId, "step 11: restore Gboard + back");
    await shell(boxHost, dbId, `ime set ${GBOARD_IME}`);
    await shell(boxHost, dbId, "input keyevent KEYCODE_BACK");

    ttLog(dbId, "postTikTokComment SUCCESS", { durationMs: Date.now() - start, sourceBytes: source.length, proofBytes: proof.length });
    return { success: true, source, proof, durationMs: Date.now() - start };
  } catch (err) {
    await shell(boxHost, dbId, `ime set ${GBOARD_IME}`).catch(() => {});
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
