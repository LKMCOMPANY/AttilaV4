/**
 * Post a reply on Twitter/X via ADB on VMOS containers.
 *
 * Auto-detects whether the Twitter app is installed:
 *   - App installed  -> deep link opens tweet in app, reply field at bottom
 *   - No app         -> deep link opens Chrome, uses intent/post URL for compose
 *
 * Both flows are fully deterministic. No LLM needed at execution time.
 */

import {
  ADBKEYBOARD_IME,
  GBOARD_IME,
  shell,
  screenshot,
  sleep,
  escapeShellText,
  extractTweetId,
  wakeDevice,
} from "./adb-helpers";

const COORDS = {
  app: {
    replyField: { x: 540, y: 2277 },
    replyButton: { x: 947, y: 2220 },
  },
  chrome: {
    replyField: { x: 300, y: 1000 },
    replyButton: { x: 920, y: 285 },
  },
};

export interface ReplyResult {
  success: boolean;
  mode: "app" | "chrome";
  source: Buffer;
  proof: Buffer;
  error?: string;
  durationMs: number;
}

async function hasTwitterApp(boxHost: string, dbId: string): Promise<boolean> {
  const result = await shell(boxHost, dbId, "pm list packages | grep twitter");
  return result.message.includes("com.twitter.android");
}

async function postReplyViaApp(
  boxHost: string, dbId: string, tweetUrl: string, text: string,
): Promise<{ source: Buffer; proof: Buffer }> {
  const c = COORDS.app;

  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${tweetUrl}`);
  await sleep(5000);

  const source = await screenshot(boxHost, dbId);

  await shell(boxHost, dbId, `input tap ${c.replyField.x} ${c.replyField.y}`);
  await sleep(1000);

  await shell(boxHost, dbId, `ime set ${ADBKEYBOARD_IME}`);
  await shell(boxHost, dbId, `am broadcast -a ADB_INPUT_TEXT --es msg "${escapeShellText(text)}"`);
  await sleep(1000);

  await shell(boxHost, dbId, `input tap ${c.replyButton.x} ${c.replyButton.y}`);
  await sleep(5000);

  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${tweetUrl}`);
  await sleep(5000);
  const proof = await screenshot(boxHost, dbId);

  return { source, proof };
}

async function postReplyViaChrome(
  boxHost: string, dbId: string, tweetUrl: string, tweetId: string, text: string,
): Promise<{ source: Buffer; proof: Buffer }> {
  const c = COORDS.chrome;

  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${tweetUrl}`);
  await sleep(5000);

  const source = await screenshot(boxHost, dbId);

  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d https://x.com/intent/post?in_reply_to=${tweetId}`);
  await sleep(5000);

  await shell(boxHost, dbId, `input tap ${c.replyField.x} ${c.replyField.y}`);
  await sleep(1000);
  await shell(boxHost, dbId, `ime set ${ADBKEYBOARD_IME}`);
  await shell(boxHost, dbId, `am broadcast -a ADB_INPUT_TEXT --es msg "${escapeShellText(text)}"`);
  await sleep(1000);

  await shell(boxHost, dbId, `input tap ${c.replyButton.x} ${c.replyButton.y}`);
  await sleep(5000);

  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${tweetUrl}`);
  await sleep(5000);
  const proof = await screenshot(boxHost, dbId);

  return { source, proof };
}

export async function postReply(
  boxHost: string,
  dbId: string,
  tweetUrl: string,
  text: string,
): Promise<ReplyResult> {
  const start = Date.now();
  const tweetId = extractTweetId(tweetUrl);

  try {
    await wakeDevice(boxHost, dbId);

    const hasApp = await hasTwitterApp(boxHost, dbId);
    const mode = hasApp ? "app" as const : "chrome" as const;

    const { source, proof } = hasApp
      ? await postReplyViaApp(boxHost, dbId, tweetUrl, text)
      : await postReplyViaChrome(boxHost, dbId, tweetUrl, tweetId, text);

    await shell(boxHost, dbId, `ime set ${GBOARD_IME}`);

    return { success: true, mode, source, proof, durationMs: Date.now() - start };
  } catch (err) {
    await shell(boxHost, dbId, `ime set ${GBOARD_IME}`).catch(() => {});
    const error = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      mode: "chrome",
      source: Buffer.alloc(0),
      proof: Buffer.alloc(0),
      error,
      durationMs: Date.now() - start,
    };
  }
}
