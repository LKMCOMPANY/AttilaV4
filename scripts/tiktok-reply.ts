/**
 * tiktok-reply.ts — Post a comment on TikTok via ADB on VMOS containers.
 *
 * Requires the TikTok app (com.zhiliaoapp.musically) installed and logged in.
 * Uses calibrated coordinates for the comment button, text field, and send button.
 *
 * Usage:
 *   npx tsx scripts/tiktok-reply.ts \
 *     --box box-1.attila.army \
 *     --device EDGEFXX5W5CEHEZ0 \
 *     --video-url "https://www.tiktok.com/@foxandfriends/video/7628192741352017165" \
 *     --text "Great video! 🔥"
 *
 * Tested: 2026-04-15 on US1 (app native)
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
  proofLoad: 5000,
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

async function screenshot(boxHost: string, dbId: string): Promise<Buffer> {
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

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

async function hasTikTokApp(
  boxHost: string,
  dbId: string
): Promise<boolean> {
  const result = await shell(
    boxHost,
    dbId,
    "pm list packages | grep musically"
  );
  return result.message.includes("com.zhiliaoapp.musically");
}

async function isAdbKeyboardEnabled(
  boxHost: string,
  dbId: string
): Promise<boolean> {
  const result = await shell(boxHost, dbId, "ime list -s");
  return result.message.includes("com.android.adbkeyboard");
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

export interface TikTokReplyResult {
  success: boolean;
  source: Buffer;
  proof: Buffer;
  error?: string;
  durationMs: number;
}

export async function postTikTokComment(
  boxHost: string,
  dbId: string,
  videoUrl: string,
  text: string
): Promise<TikTokReplyResult> {
  const start = Date.now();

  try {
    // Pre-flight checks
    const hasApp = await hasTikTokApp(boxHost, dbId);
    if (!hasApp) {
      throw new Error("TikTok app (com.zhiliaoapp.musically) not installed");
    }

    console.log(`[tiktok] Device ${dbId}`);
    console.log(`[tiktok] Video: ${videoUrl}`);
    console.log(`[tiktok] Text: ${text}`);

    // Ensure ADBKeyboard is enabled (not set, just enabled)
    const adbkEnabled = await isAdbKeyboardEnabled(boxHost, dbId);
    if (!adbkEnabled) {
      await shell(boxHost, dbId, `ime enable ${ADBKEYBOARD_IME}`);
    }

    // --- STEP 1: Wake ---
    await shell(boxHost, dbId, "input keyevent KEYCODE_WAKEUP");

    // --- STEP 2: Open video via deep link ---
    await shell(
      boxHost,
      dbId,
      `am start -a android.intent.action.VIEW -d ${videoUrl}`
    );
    await sleep(TIMING.videoLoad);

    // --- STEP 3: Screenshot SOURCE ---
    const source = await screenshot(boxHost, dbId);
    console.log("[tiktok] Screenshot source captured");

    // --- STEP 4: Tap comment button (💬) ---
    await shell(
      boxHost,
      dbId,
      `input tap ${COORDS.commentButton.x} ${COORDS.commentButton.y}`
    );
    await sleep(TIMING.panelSlide);

    // --- STEP 5: Tap "Add comment..." field ---
    await shell(
      boxHost,
      dbId,
      `input tap ${COORDS.commentField.x} ${COORDS.commentField.y}`
    );
    await sleep(TIMING.keyboardAppear);

    // --- STEP 6: Switch to ADBKeyboard ---
    await shell(boxHost, dbId, `ime set ${ADBKEYBOARD_IME}`);

    // --- STEP 7: Re-tap field to restore focus after IME switch ---
    await shell(
      boxHost,
      dbId,
      `input tap ${COORDS.commentField.x} ${COORDS.commentField.y}`
    );
    await sleep(TIMING.imeSwitch);

    // --- STEP 8: Type the comment ---
    await shell(
      boxHost,
      dbId,
      `am broadcast -a ADB_INPUT_TEXT --es msg "${escapeShellText(text)}"`
    );
    await sleep(TIMING.afterType);

    // --- STEP 9: Tap send button ---
    await shell(
      boxHost,
      dbId,
      `input tap ${COORDS.sendButton.x} ${COORDS.sendButton.y}`
    );
    await sleep(TIMING.afterSend);

    // --- STEP 10: Screenshot PROOF ---
    const proof = await screenshot(boxHost, dbId);
    console.log("[tiktok] Screenshot proof captured");

    // --- STEP 11: Restore Gboard ---
    await shell(boxHost, dbId, `ime set ${GBOARD_IME}`);

    // --- STEP 12: Close comment panel ---
    await shell(boxHost, dbId, "input keyevent KEYCODE_BACK");

    const durationMs = Date.now() - start;
    console.log(`[tiktok] Done in ${durationMs}ms`);

    return { success: true, source, proof, durationMs };
  } catch (err) {
    await shell(boxHost, dbId, `ime set ${GBOARD_IME}`).catch(() => {});

    const error = err instanceof Error ? err.message : String(err);
    console.error(`[tiktok] FAILED: ${error}`);

    return {
      success: false,
      source: Buffer.alloc(0),
      proof: Buffer.alloc(0),
      error,
      durationMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Calibration helper
// ---------------------------------------------------------------------------

/**
 * Enable pointer_location overlay so an operator can find button coordinates
 * via streaming. Call with enable=false to disable after calibration.
 */
export async function setPointerLocation(
  boxHost: string,
  dbId: string,
  enable: boolean
): Promise<void> {
  await shell(
    boxHost,
    dbId,
    `settings put system pointer_location ${enable ? 1 : 0}`
  );
  console.log(
    `[tiktok] Pointer location ${enable ? "enabled" : "disabled"} on ${dbId}`
  );
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

  if (!process.env.CF_ACCESS_CLIENT_ID || !process.env.CF_ACCESS_CLIENT_SECRET) {
    throw new Error(
      "Missing CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET env vars"
    );
  }

  // Calibration mode
  if (args.includes("--calibrate")) {
    const boxHost = getArg("box");
    const dbId = getArg("device");
    const enable = !args.includes("--off");
    await setPointerLocation(boxHost, dbId, enable);
    console.log(
      enable
        ? "Pointer location ON — tap buttons via streaming to see X/Y coordinates"
        : "Pointer location OFF"
    );
    return;
  }

  const boxHost = getArg("box");
  const dbId = getArg("device");
  const videoUrl = getArg("video-url");
  const text = getArg("text");

  console.log("=== TIKTOK-REPLY ===");
  console.log(`Box:    ${boxHost}`);
  console.log(`Device: ${dbId}`);
  console.log(`Video:  ${videoUrl}`);
  console.log(`Text:   ${text}`);
  console.log("");

  const result = await postTikTokComment(boxHost, dbId, videoUrl, text);

  if (result.success) {
    console.log(`\n✅ Comment posted in ${result.durationMs}ms`);

    const fs = await import("fs");
    const timestamp = Date.now();
    const sourceFile = `tiktok_source_${timestamp}.jpg`;
    const proofFile = `tiktok_proof_${timestamp}.jpg`;

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
