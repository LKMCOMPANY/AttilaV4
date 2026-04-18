/**
 * CLI wrapper for X/Twitter reply automation.
 *
 * Usage:
 *   npx tsx scripts/x-reply.ts \
 *     --box box-1.attila.army \
 *     --device EDGE3BD3397RQJPC \
 *     --tweet-url "https://x.com/JustRocketMan/status/2038939433567670517" \
 *     --text "Great post!"
 *
 * Core logic lives in src/lib/automation/x-reply.ts
 */

import { postReply } from "../src/lib/automation/x-reply";

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

  const boxHost = getArg("box");
  const dbId = getArg("device");
  const tweetUrl = getArg("tweet-url");
  const text = getArg("text");

  console.log("=== X-REPLY ===");
  console.log(`Box:    ${boxHost}`);
  console.log(`Device: ${dbId}`);
  console.log(`Tweet:  ${tweetUrl}`);
  console.log(`Text:   ${text}\n`);

  const result = await postReply(boxHost, dbId, tweetUrl, text);

  if (result.success) {
    console.log(`\nReply posted in ${result.durationMs}ms`);

    const fs = await import("fs");
    const timestamp = Date.now();
    fs.writeFileSync(`screenshot_source_${timestamp}.jpg`, result.source);
    fs.writeFileSync(`screenshot_proof_${timestamp}.jpg`, result.proof);
    console.log(`Source: screenshot_source_${timestamp}.jpg`);
    console.log(`Proof:  screenshot_proof_${timestamp}.jpg`);
  } else {
    console.error(`\nFailed: ${result.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
