/**
 * x-reply.ts — Post a reply on Twitter/X via ADB on VMOS containers.
 *
 * Auto-detects whether the Twitter app is installed:
 *   - App installed  → deep link opens tweet in app, reply field at bottom
 *   - No app         → deep link opens Chrome, uses intent/post URL for compose
 *
 * Both flows are fully deterministic. No LLM needed at execution time.
 *
 * Usage:
 *   npx tsx scripts/x-reply.ts \
 *     --box box-1.attila.army \
 *     --device EDGE3BD3397RQJPC \
 *     --tweet-url "https://x.com/JustRocketMan/status/2038939433567670517" \
 *     --text "Great post! 🔥"
 *
 * Tested: 2026-04-15 on FR2, FR8 (Chrome), US1 (App native)
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CF_HEADERS = {
  "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID!,
  "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET!,
};

const ADBKEYBOARD_IME = "com.android.adbkeyboard/.AdbIME";
const GBOARD_IME =
  "com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME";

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

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

async function shell(
  boxHost: string,
  dbId: string,
  cmd: string
): Promise<{ code: number; message: string }> {
  const res = await fetch(
    `https://${boxHost}/android_api/v1/shell/${dbId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...CF_HEADERS },
      body: JSON.stringify({ id: dbId, cmd }),
    }
  );
  const json = await res.json();
  return { code: json.code, message: json.data?.message ?? "" };
}

async function screenshot(
  boxHost: string,
  dbId: string
): Promise<Buffer> {
  const res = await fetch(
    `https://${boxHost}/container_api/v1/screenshots/${dbId}`,
    { headers: CF_HEADERS }
  );
  return Buffer.from(await res.arrayBuffer());
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeShellText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function extractTweetId(tweetUrl: string): string {
  const match = tweetUrl.match(/status\/(\d+)/);
  if (!match) throw new Error(`Cannot extract tweet ID from: ${tweetUrl}`);
  return match[1];
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

async function hasTwitterApp(
  boxHost: string,
  dbId: string
): Promise<boolean> {
  const result = await shell(boxHost, dbId, "pm list packages | grep twitter");
  return result.message.includes("com.twitter.android");
}

async function isDeviceAwake(
  boxHost: string,
  dbId: string
): Promise<boolean> {
  const result = await shell(
    boxHost,
    dbId,
    "dumpsys power | grep mWakefulness"
  );
  return result.message.includes("Awake");
}

// ---------------------------------------------------------------------------
// Flow: App native
// ---------------------------------------------------------------------------

async function postReplyViaApp(
  boxHost: string,
  dbId: string,
  tweetUrl: string,
  text: string
): Promise<{ source: Buffer; proof: Buffer }> {
  const c = COORDS.app;

  // Open tweet in Twitter app
  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${tweetUrl}`);
  await sleep(5000);

  const source = await screenshot(boxHost, dbId);

  // Tap "Post your reply" field at bottom of screen
  await shell(boxHost, dbId, `input tap ${c.replyField.x} ${c.replyField.y}`);
  await sleep(1000);

  // Switch to ADBKeyboard + type
  await shell(boxHost, dbId, `ime set ${ADBKEYBOARD_IME}`);
  await shell(
    boxHost,
    dbId,
    `am broadcast -a ADB_INPUT_TEXT --es msg "${escapeShellText(text)}"`
  );
  await sleep(1000);

  // Tap Reply button
  await shell(boxHost, dbId, `input tap ${c.replyButton.x} ${c.replyButton.y}`);
  await sleep(5000);

  // Screenshot proof — reopen tweet
  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${tweetUrl}`);
  await sleep(5000);
  const proof = await screenshot(boxHost, dbId);

  return { source, proof };
}

// ---------------------------------------------------------------------------
// Flow: Chrome web
// ---------------------------------------------------------------------------

async function postReplyViaChrome(
  boxHost: string,
  dbId: string,
  tweetUrl: string,
  tweetId: string,
  text: string
): Promise<{ source: Buffer; proof: Buffer }> {
  const c = COORDS.chrome;

  // Open tweet in Chrome
  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${tweetUrl}`);
  await sleep(5000);

  const source = await screenshot(boxHost, dbId);

  // Open compose reply via intent URL
  await shell(
    boxHost,
    dbId,
    `am start -a android.intent.action.VIEW -d https://x.com/intent/post?in_reply_to=${tweetId}`
  );
  await sleep(5000);

  // Focus field + switch keyboard + type
  await shell(boxHost, dbId, `input tap ${c.replyField.x} ${c.replyField.y}`);
  await sleep(1000);
  await shell(boxHost, dbId, `ime set ${ADBKEYBOARD_IME}`);
  await shell(
    boxHost,
    dbId,
    `am broadcast -a ADB_INPUT_TEXT --es msg "${escapeShellText(text)}"`
  );
  await sleep(1000);

  // Tap Reply button
  await shell(boxHost, dbId, `input tap ${c.replyButton.x} ${c.replyButton.y}`);
  await sleep(5000);

  // Screenshot proof — reopen tweet
  await shell(boxHost, dbId, `am start -a android.intent.action.VIEW -d ${tweetUrl}`);
  await sleep(5000);
  const proof = await screenshot(boxHost, dbId);

  return { source, proof };
}

// ---------------------------------------------------------------------------
// Main: unified entry point
// ---------------------------------------------------------------------------

export interface ReplyResult {
  success: boolean;
  mode: "app" | "chrome";
  source: Buffer;
  proof: Buffer;
  error?: string;
  durationMs: number;
}

export async function postReply(
  boxHost: string,
  dbId: string,
  tweetUrl: string,
  text: string
): Promise<ReplyResult> {
  const start = Date.now();
  const tweetId = extractTweetId(tweetUrl);

  try {
    // Wake device
    const awake = await isDeviceAwake(boxHost, dbId);
    if (!awake) {
      await shell(boxHost, dbId, "input keyevent KEYCODE_WAKEUP");
      await sleep(1000);
    }

    // Detect mode
    const hasApp = await hasTwitterApp(boxHost, dbId);
    const mode = hasApp ? "app" : "chrome";

    console.log(`[x-reply] Device ${dbId} — mode: ${mode}`);
    console.log(`[x-reply] Tweet: ${tweetUrl}`);
    console.log(`[x-reply] Text: ${text}`);

    // Execute the appropriate flow
    const { source, proof } = hasApp
      ? await postReplyViaApp(boxHost, dbId, tweetUrl, text)
      : await postReplyViaChrome(boxHost, dbId, tweetUrl, tweetId, text);

    // Restore Gboard
    await shell(boxHost, dbId, `ime set ${GBOARD_IME}`);

    const durationMs = Date.now() - start;
    console.log(`[x-reply] Done in ${durationMs}ms — mode: ${mode}`);

    return { success: true, mode, source, proof, durationMs };
  } catch (err) {
    // Restore Gboard on error
    await shell(boxHost, dbId, `ime set ${GBOARD_IME}`).catch(() => {});

    const error = err instanceof Error ? err.message : String(err);
    console.error(`[x-reply] FAILED: ${error}`);

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

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  function getArg(name: string): string {
    const idx = args.indexOf(`--${name}`);
    if (idx === -1 || idx + 1 >= args.length) {
      throw new Error(`Missing required argument: --${name}`);
    }
    return args[idx + 1];
  }

  const boxHost = getArg("box");
  const dbId = getArg("device");
  const tweetUrl = getArg("tweet-url");
  const text = getArg("text");

  if (!process.env.CF_ACCESS_CLIENT_ID || !process.env.CF_ACCESS_CLIENT_SECRET) {
    throw new Error(
      "Missing CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET env vars"
    );
  }

  console.log("=== X-REPLY ===");
  console.log(`Box:    ${boxHost}`);
  console.log(`Device: ${dbId}`);
  console.log(`Tweet:  ${tweetUrl}`);
  console.log(`Text:   ${text}`);
  console.log("");

  const result = await postReply(boxHost, dbId, tweetUrl, text);

  if (result.success) {
    console.log(`\n✅ Reply posted (${result.mode} mode) in ${result.durationMs}ms`);

    // Save screenshots
    const fs = await import("fs");
    const timestamp = Date.now();
    const sourceFile = `screenshot_source_${timestamp}.jpg`;
    const proofFile = `screenshot_proof_${timestamp}.jpg`;

    fs.writeFileSync(sourceFile, result.source);
    fs.writeFileSync(proofFile, result.proof);

    console.log(`📸 Source: ${sourceFile}`);
    console.log(`📸 Proof:  ${proofFile}`);
  } else {
    console.error(`\n❌ Failed: ${result.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
