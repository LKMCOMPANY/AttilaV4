/**
 * Shared low-level ADB helpers for automation scripts.
 * Used by both x-reply and tiktok-reply modules.
 */

import { getCfHeaders } from "@/lib/box-api";

export const ADBKEYBOARD_IME = "com.android.adbkeyboard/.AdbIME";
export const GBOARD_IME =
  "com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME";

export async function shell(
  boxHost: string,
  dbId: string,
  cmd: string,
): Promise<{ code: number; message: string }> {
  const res = await fetch(
    `https://${boxHost}/android_api/v1/shell/${dbId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getCfHeaders() },
      body: JSON.stringify({ id: dbId, cmd }),
    },
  );
  const json = await res.json();
  return { code: json.code, message: json.data?.message ?? "" };
}

export async function screenshot(
  boxHost: string,
  dbId: string,
): Promise<Buffer> {
  const res = await fetch(
    `https://${boxHost}/container_api/v1/screenshots/${dbId}`,
    { headers: getCfHeaders() },
  );
  return Buffer.from(await res.arrayBuffer());
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function escapeShellText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function extractTweetId(tweetUrl: string): string {
  const match = tweetUrl.match(/status\/(\d+)/);
  if (!match) throw new Error(`Cannot extract tweet ID from: ${tweetUrl}`);
  return match[1];
}

export async function isDeviceAwake(
  boxHost: string,
  dbId: string,
): Promise<boolean> {
  const result = await shell(boxHost, dbId, "dumpsys power | grep mWakefulness");
  return result.message.includes("Awake");
}

export async function wakeDevice(
  boxHost: string,
  dbId: string,
): Promise<void> {
  const awake = await isDeviceAwake(boxHost, dbId);
  if (!awake) {
    await shell(boxHost, dbId, "input keyevent KEYCODE_WAKEUP");
    await sleep(1000);
  }
}
