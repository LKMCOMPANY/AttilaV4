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

function xLog(dbId: string, step: string, data?: Record<string, unknown>) {
  console.log(`[X-Reply][${dbId}] ${step}`, data ? JSON.stringify(data) : "");
}

async function hasTwitterApp(boxHost: string, dbId: string): Promise<boolean> {
  const result = await shell(boxHost, dbId, "pm list packages | grep twitter");
  const found = result.message.includes("com.twitter.android");
  xLog(dbId, `hasTwitterApp: ${found}`, { raw: result.message.trim() });
  return found;
}

async function postReplyViaApp(
  boxHost: string, dbId: string, tweetUrl: string, text: string,
): Promise<{ source: Buffer; proof: Buffer }> {
  const c = COORDS.app;

  xLog(dbId, "APP FLOW — step 1: open tweet via deep link", { url: tweetUrl });
  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${tweetUrl}`);
  await sleep(5000);

  xLog(dbId, "APP FLOW — step 2: screenshot source");
  const source = await screenshot(boxHost, dbId);

  xLog(dbId, "APP FLOW — step 3: tap reply field", { coords: c.replyField });
  await shell(boxHost, dbId, `input tap ${c.replyField.x} ${c.replyField.y}`);
  await sleep(1000);

  xLog(dbId, "APP FLOW — step 4: set ADBKeyboard + type text", { textLength: text.length });
  await shell(boxHost, dbId, `ime set ${ADBKEYBOARD_IME}`);
  await shell(boxHost, dbId, `am broadcast -a ADB_INPUT_TEXT --es msg "${escapeShellText(text)}"`);
  await sleep(1000);

  xLog(dbId, "APP FLOW — step 5: tap reply button", { coords: c.replyButton });
  await shell(boxHost, dbId, `input tap ${c.replyButton.x} ${c.replyButton.y}`);
  await sleep(5000);

  xLog(dbId, "APP FLOW — step 6: reopen tweet for proof screenshot");
  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${tweetUrl}`);
  await sleep(5000);
  const proof = await screenshot(boxHost, dbId);

  xLog(dbId, "APP FLOW — complete", { sourceBytes: source.length, proofBytes: proof.length });
  return { source, proof };
}

async function postReplyViaChrome(
  boxHost: string, dbId: string, tweetUrl: string, tweetId: string, text: string,
): Promise<{ source: Buffer; proof: Buffer }> {
  const c = COORDS.chrome;

  xLog(dbId, "CHROME FLOW — step 1: open tweet in browser", { url: tweetUrl });
  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${tweetUrl}`);
  await sleep(5000);

  xLog(dbId, "CHROME FLOW — step 2: screenshot source");
  const source = await screenshot(boxHost, dbId);

  xLog(dbId, "CHROME FLOW — step 3: open reply intent", { tweetId });
  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d https://x.com/intent/post?in_reply_to=${tweetId}`);
  await sleep(5000);

  xLog(dbId, "CHROME FLOW — step 4: tap reply field", { coords: c.replyField });
  await shell(boxHost, dbId, `input tap ${c.replyField.x} ${c.replyField.y}`);
  await sleep(1000);

  xLog(dbId, "CHROME FLOW — step 5: set ADBKeyboard + type text", { textLength: text.length });
  await shell(boxHost, dbId, `ime set ${ADBKEYBOARD_IME}`);
  await shell(boxHost, dbId, `am broadcast -a ADB_INPUT_TEXT --es msg "${escapeShellText(text)}"`);
  await sleep(1000);

  xLog(dbId, "CHROME FLOW — step 6: tap reply button", { coords: c.replyButton });
  await shell(boxHost, dbId, `input tap ${c.replyButton.x} ${c.replyButton.y}`);
  await sleep(5000);

  xLog(dbId, "CHROME FLOW — step 7: reopen tweet for proof screenshot");
  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${tweetUrl}`);
  await sleep(5000);
  const proof = await screenshot(boxHost, dbId);

  xLog(dbId, "CHROME FLOW — complete", { sourceBytes: source.length, proofBytes: proof.length });
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

  xLog(dbId, "postReply START", { boxHost, tweetUrl, tweetId, textPreview: text.slice(0, 60) });

  try {
    await wakeDevice(boxHost, dbId);

    const hasApp = await hasTwitterApp(boxHost, dbId);
    const mode = hasApp ? "app" as const : "chrome" as const;
    xLog(dbId, `Mode selected: ${mode}`);

    const { source, proof } = hasApp
      ? await postReplyViaApp(boxHost, dbId, tweetUrl, text)
      : await postReplyViaChrome(boxHost, dbId, tweetUrl, tweetId, text);

    await shell(boxHost, dbId, `ime set ${GBOARD_IME}`);

    xLog(dbId, "postReply SUCCESS", { mode, durationMs: Date.now() - start, sourceBytes: source.length, proofBytes: proof.length });
    return { success: true, mode, source, proof, durationMs: Date.now() - start };
  } catch (err) {
    await shell(boxHost, dbId, `ime set ${GBOARD_IME}`).catch(() => {});
    const error = err instanceof Error ? err.message : String(err);
    xLog(dbId, "postReply FAILED", { error, durationMs: Date.now() - start });
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
