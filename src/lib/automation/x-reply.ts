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
  shell,
  screenshot,
  sleep,
  extractTweetId,
  wakeDevice,
  ensureAdbKeyboard,
  typeText,
  restoreGboard,
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

const TIMING = {
  pageLoad: 6000,
  afterTapField: 1500,
  afterType: 1000,
  afterPost: 6000,
  proofReload: 6000,
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
  boxHost: string,
  dbId: string,
  tweetUrl: string,
  text: string,
): Promise<{ source: Buffer; proof: Buffer }> {
  const c = COORDS.app;

  // --- Step 1: Open tweet via deep link ---
  xLog(dbId, "APP — open tweet via deep link", { url: tweetUrl });
  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${tweetUrl}`);
  await sleep(TIMING.pageLoad);

  // --- Step 2: Screenshot source (tweet loaded) ---
  xLog(dbId, "APP — screenshot source");
  const source = await screenshot(boxHost, dbId);

  // --- Step 3: Tap reply field ---
  xLog(dbId, "APP — tap reply field", { coords: c.replyField });
  await shell(boxHost, dbId, `input tap ${c.replyField.x} ${c.replyField.y}`);
  await sleep(TIMING.afterTapField);

  // --- Step 4: Activate ADBKeyboard + re-tap field for focus ---
  xLog(dbId, "APP — activate ADBKeyboard");
  const kbReady = await ensureAdbKeyboard(boxHost, dbId);
  if (!kbReady) throw new Error("ADBKeyboard activation failed");

  xLog(dbId, "APP — re-tap reply field after IME switch");
  await shell(boxHost, dbId, `input tap ${c.replyField.x} ${c.replyField.y}`);
  await sleep(500);

  // --- Step 5: Type text ---
  xLog(dbId, "APP — type text", { textLength: text.length });
  const typed = await typeText(boxHost, dbId, text);
  if (!typed) throw new Error("Text broadcast failed");
  await sleep(TIMING.afterType);

  // --- Step 6: Tap reply/post button ---
  xLog(dbId, "APP — tap reply button", { coords: c.replyButton });
  await shell(boxHost, dbId, `input tap ${c.replyButton.x} ${c.replyButton.y}`);
  await sleep(TIMING.afterPost);

  // --- Step 7: Reopen tweet + wait for reply to appear ---
  xLog(dbId, "APP — reopen tweet for proof screenshot");
  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${tweetUrl}`);
  await sleep(TIMING.proofReload);

  // --- Step 8: Screenshot proof ---
  const proof = await screenshot(boxHost, dbId);
  xLog(dbId, "APP — complete", { sourceBytes: source.length, proofBytes: proof.length });

  return { source, proof };
}

async function postReplyViaChrome(
  boxHost: string,
  dbId: string,
  tweetUrl: string,
  tweetId: string,
  text: string,
): Promise<{ source: Buffer; proof: Buffer }> {
  const c = COORDS.chrome;

  // --- Step 1: Open tweet in browser ---
  xLog(dbId, "CHROME — open tweet in browser", { url: tweetUrl });
  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${tweetUrl}`);
  await sleep(TIMING.pageLoad);

  // --- Step 2: Screenshot source ---
  xLog(dbId, "CHROME — screenshot source");
  const source = await screenshot(boxHost, dbId);

  // --- Step 3: Open reply intent page ---
  xLog(dbId, "CHROME — open reply intent", { tweetId });
  const intentUrl = `https://x.com/intent/post?in_reply_to=${tweetId}`;
  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${intentUrl}`);
  await sleep(TIMING.pageLoad);

  // --- Step 4: Tap reply field ---
  xLog(dbId, "CHROME — tap reply field", { coords: c.replyField });
  await shell(boxHost, dbId, `input tap ${c.replyField.x} ${c.replyField.y}`);
  await sleep(TIMING.afterTapField);

  // --- Step 5: Activate ADBKeyboard + re-tap field ---
  xLog(dbId, "CHROME — activate ADBKeyboard");
  const kbReady = await ensureAdbKeyboard(boxHost, dbId);
  if (!kbReady) throw new Error("ADBKeyboard activation failed");

  xLog(dbId, "CHROME — re-tap reply field after IME switch");
  await shell(boxHost, dbId, `input tap ${c.replyField.x} ${c.replyField.y}`);
  await sleep(500);

  // --- Step 6: Type text ---
  xLog(dbId, "CHROME — type text", { textLength: text.length });
  const typed = await typeText(boxHost, dbId, text);
  if (!typed) throw new Error("Text broadcast failed");
  await sleep(TIMING.afterType);

  // --- Step 7: Tap reply button ---
  xLog(dbId, "CHROME — tap reply button", { coords: c.replyButton });
  await shell(boxHost, dbId, `input tap ${c.replyButton.x} ${c.replyButton.y}`);
  await sleep(TIMING.afterPost);

  // --- Step 8: Reopen tweet for proof ---
  xLog(dbId, "CHROME — reopen tweet for proof screenshot");
  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${tweetUrl}`);
  await sleep(TIMING.proofReload);

  // --- Step 9: Screenshot proof ---
  const proof = await screenshot(boxHost, dbId);
  xLog(dbId, "CHROME — complete", { sourceBytes: source.length, proofBytes: proof.length });

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

    await restoreGboard(boxHost, dbId);

    xLog(dbId, "postReply SUCCESS", {
      mode,
      durationMs: Date.now() - start,
      sourceBytes: source.length,
      proofBytes: proof.length,
    });
    return { success: true, mode, source, proof, durationMs: Date.now() - start };
  } catch (err) {
    await restoreGboard(boxHost, dbId);
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
