/**
 * Shared low-level ADB helpers for automation scripts.
 * Used by both x-reply and tiktok-reply modules.
 */

import { getCfHeaders } from "@/lib/box-api";

export const ADBKEYBOARD_IME = "com.android.adbkeyboard/.AdbIME";
export const GBOARD_IME =
  "com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME";

function adbLog(dbId: string, message: string, data?: Record<string, unknown>) {
  const tag = `[ADB][${dbId}]`;
  console.log(`${tag} ${message}`, data ? JSON.stringify(data) : "");
}

export async function shell(
  boxHost: string,
  dbId: string,
  cmd: string,
): Promise<{ code: number; message: string }> {
  const url = `https://${boxHost}/android_api/v1/shell/${dbId}`;
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getCfHeaders() },
      body: JSON.stringify({ id: dbId, cmd }),
    });

    if (!res.ok) {
      const body = await res.text();
      adbLog(dbId, `shell FAILED`, { cmd, httpStatus: res.status, body: body.slice(0, 200), ms: Date.now() - start });
      return { code: -1, message: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }

    const json = await res.json();
    const result = { code: json.code, message: json.data?.message ?? "" };
    adbLog(dbId, `shell OK`, {
      cmd: cmd.length > 80 ? cmd.slice(0, 80) + "…" : cmd,
      code: result.code,
      output: result.message.length > 200 ? result.message.slice(0, 200) + "…" : result.message,
      ms: Date.now() - start,
    });
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    adbLog(dbId, `shell ERROR`, { cmd, error, ms: Date.now() - start });
    throw err;
  }
}

export async function screenshot(
  boxHost: string,
  dbId: string,
): Promise<Buffer> {
  const url = `https://${boxHost}/container_api/v1/screenshots/${dbId}`;
  const start = Date.now();

  try {
    const res = await fetch(url, { headers: getCfHeaders() });

    if (!res.ok) {
      const body = await res.text();
      adbLog(dbId, `screenshot FAILED`, { httpStatus: res.status, body: body.slice(0, 200), ms: Date.now() - start });
      return Buffer.alloc(0);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    adbLog(dbId, `screenshot OK`, { bytes: buf.length, ms: Date.now() - start });
    return buf;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    adbLog(dbId, `screenshot ERROR`, { error, ms: Date.now() - start });
    throw err;
  }
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
  const awake = result.message.includes("Awake");
  adbLog(dbId, `isDeviceAwake: ${awake}`, { raw: result.message.trim() });
  return awake;
}

export async function wakeDevice(
  boxHost: string,
  dbId: string,
): Promise<void> {
  adbLog(dbId, "wakeDevice START");
  const awake = await isDeviceAwake(boxHost, dbId);
  if (!awake) {
    adbLog(dbId, "Device asleep, sending WAKEUP");
    await shell(boxHost, dbId, "input keyevent KEYCODE_WAKEUP");
    await sleep(1000);
  } else {
    adbLog(dbId, "Device already awake");
  }
}
