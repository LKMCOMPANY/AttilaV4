/**
 * CLI wrapper for TikTok comment automation.
 *
 * Usage:
 *   npx tsx scripts/tiktok-reply.ts \
 *     --box box-1.attila.army \
 *     --device EDGEFXX5W5CEHEZ0 \
 *     --video-url "https://www.tiktok.com/@foxandfriends/video/7628192741352017165" \
 *     --text "Great video!"
 *
 * Calibration mode:
 *   npx tsx scripts/tiktok-reply.ts --calibrate --box ... --device ...
 *
 * Core logic lives in src/lib/automation/tiktok-reply.ts
 */

import { postTikTokComment, setPointerLocation } from "../src/lib/automation/tiktok-reply";

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
    throw new Error("Missing CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET env vars");
  }

  if (args.includes("--calibrate")) {
    const boxHost = getArg("box");
    const dbId = getArg("device");
    const enable = !args.includes("--off");
    await setPointerLocation(boxHost, dbId, enable);
    console.log(enable
      ? "Pointer location ON — tap buttons via streaming to see X/Y coordinates"
      : "Pointer location OFF");
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
  console.log(`Text:   ${text}\n`);

  const result = await postTikTokComment(boxHost, dbId, videoUrl, text);

  if (result.success) {
    console.log(`\nComment posted in ${result.durationMs}ms`);

    const fs = await import("fs");
    const timestamp = Date.now();
    fs.writeFileSync(`tiktok_source_${timestamp}.jpg`, result.source);
    fs.writeFileSync(`tiktok_proof_${timestamp}.jpg`, result.proof);
    console.log(`Source: tiktok_source_${timestamp}.jpg`);
    console.log(`Proof:  tiktok_proof_${timestamp}.jpg`);
  } else {
    console.error(`\nFailed: ${result.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
