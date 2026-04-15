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

async function hasTikTokApp(boxHost: string, dbId: string): Promise<boolean> {
  const result = await shell(boxHost, dbId, "pm list packages | grep musically");
  return result.message.includes("com.zhiliaoapp.musically");
}

async function isAdbKeyboardEnabled(boxHost: string, dbId: string): Promise<boolean> {
  const result = await shell(boxHost, dbId, "ime list -s");
  return result.message.includes("com.android.adbkeyboard");
}

export async function postTikTokComment(
  boxHost: string,
  dbId: string,
  videoUrl: string,
  text: string,
): Promise<TikTokReplyResult> {
  const start = Date.now();

  try {
    const hasApp = await hasTikTokApp(boxHost, dbId);
    if (!hasApp) {
      throw new Error("TikTok app (com.zhiliaoapp.musically) not installed");
    }

    const adbkEnabled = await isAdbKeyboardEnabled(boxHost, dbId);
    if (!adbkEnabled) {
      await shell(boxHost, dbId, `ime enable ${ADBKEYBOARD_IME}`);
    }

    await shell(boxHost, dbId, "input keyevent KEYCODE_WAKEUP");

    await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${videoUrl}`);
    await sleep(TIMING.videoLoad);

    const source = await screenshot(boxHost, dbId);

    await shell(boxHost, dbId, `input tap ${COORDS.commentButton.x} ${COORDS.commentButton.y}`);
    await sleep(TIMING.panelSlide);

    await shell(boxHost, dbId, `input tap ${COORDS.commentField.x} ${COORDS.commentField.y}`);
    await sleep(TIMING.keyboardAppear);

    await shell(boxHost, dbId, `ime set ${ADBKEYBOARD_IME}`);
    await shell(boxHost, dbId, `input tap ${COORDS.commentField.x} ${COORDS.commentField.y}`);
    await sleep(TIMING.imeSwitch);

    await shell(boxHost, dbId, `am broadcast -a ADB_INPUT_TEXT --es msg "${escapeShellText(text)}"`);
    await sleep(TIMING.afterType);

    await shell(boxHost, dbId, `input tap ${COORDS.sendButton.x} ${COORDS.sendButton.y}`);
    await sleep(TIMING.afterSend);

    const proof = await screenshot(boxHost, dbId);

    await shell(boxHost, dbId, `ime set ${GBOARD_IME}`);
    await shell(boxHost, dbId, "input keyevent KEYCODE_BACK");

    return { success: true, source, proof, durationMs: Date.now() - start };
  } catch (err) {
    await shell(boxHost, dbId, `ime set ${GBOARD_IME}`).catch(() => {});
    const error = err instanceof Error ? err.message : String(err);
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
