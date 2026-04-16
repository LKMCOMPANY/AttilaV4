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

export interface ShellResult {
  code: number;
  message: string;
  ok: boolean;
}

export async function shell(
  boxHost: string,
  dbId: string,
  cmd: string,
): Promise<ShellResult> {
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
      return { code: -1, message: `HTTP ${res.status}: ${body.slice(0, 200)}`, ok: false };
    }

    const json = await res.json();
    const vmosCode = json.code ?? -1;
    const message = json.data?.message ?? "";
    const ok = vmosCode === 200;

    adbLog(dbId, ok ? `shell OK` : `shell WARN`, {
      cmd: cmd.length > 80 ? cmd.slice(0, 80) + "…" : cmd,
      code: vmosCode,
      output: message.length > 200 ? message.slice(0, 200) + "…" : message,
      ms: Date.now() - start,
    });
    return { code: vmosCode, message, ok };
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
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
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

/**
 * Wake the device and dismiss the lock screen.
 * Sends WAKEUP + MENU (unlocks most lock screens without PIN).
 * Verifies the device is awake after, retries once if needed.
 */
export async function wakeDevice(
  boxHost: string,
  dbId: string,
): Promise<void> {
  adbLog(dbId, "wakeDevice START");

  const awake = await isDeviceAwake(boxHost, dbId);
  if (awake) {
    adbLog(dbId, "Device already awake");
    return;
  }

  adbLog(dbId, "Device asleep, sending WAKEUP + MENU");
  await shell(boxHost, dbId, "input keyevent KEYCODE_WAKEUP");
  await sleep(500);
  await shell(boxHost, dbId, "input keyevent KEYCODE_MENU");
  await sleep(1000);

  const stillAsleep = !(await isDeviceAwake(boxHost, dbId));
  if (stillAsleep) {
    adbLog(dbId, "Still asleep after first attempt, retrying with swipe unlock");
    await shell(boxHost, dbId, "input keyevent KEYCODE_WAKEUP");
    await sleep(500);
    await shell(boxHost, dbId, "input swipe 540 1800 540 800 300");
    await sleep(1000);
  }
}

/**
 * Enable and activate ADBKeyboard. Verifies the switch actually succeeded.
 * Must be called BEFORE any `am broadcast -a ADB_INPUT_TEXT` call.
 * Returns true if ADBKeyboard is ready, false on failure.
 */
export async function ensureAdbKeyboard(
  boxHost: string,
  dbId: string,
): Promise<boolean> {
  adbLog(dbId, "ensureAdbKeyboard START");

  await shell(boxHost, dbId, `ime enable ${ADBKEYBOARD_IME}`);
  await sleep(300);

  const setResult = await shell(boxHost, dbId, `ime set ${ADBKEYBOARD_IME}`);

  if (!setResult.ok || setResult.message.includes("Unknown input method")) {
    adbLog(dbId, "ensureAdbKeyboard FAILED — ADBKeyboard not recognized", {
      code: setResult.code,
      output: setResult.message,
    });
    return false;
  }

  await sleep(300);

  const verify = await shell(boxHost, dbId, "settings get secure default_input_method");
  const active = verify.message.includes("adbkeyboard");
  adbLog(dbId, `ensureAdbKeyboard ${active ? "READY" : "NOT ACTIVE"}`, {
    currentIme: verify.message.trim(),
  });
  return active;
}

/**
 * Type text via ADBKeyboard broadcast. Verifies the broadcast was received.
 * Returns true if the broadcast completed successfully.
 */
export async function typeText(
  boxHost: string,
  dbId: string,
  text: string,
): Promise<boolean> {
  const escaped = escapeShellText(text);
  const result = await shell(
    boxHost,
    dbId,
    `am broadcast -a ADB_INPUT_TEXT --es msg "${escaped}"`,
  );

  const received = result.ok && result.message.includes("Broadcast completed");
  adbLog(dbId, `typeText ${received ? "OK" : "FAILED"}`, {
    textLength: text.length,
    broadcastResult: result.message.slice(0, 100),
  });
  return received;
}

/**
 * Restore Gboard as the active keyboard. Best-effort, never throws.
 */
export async function restoreGboard(
  boxHost: string,
  dbId: string,
): Promise<void> {
  await shell(boxHost, dbId, `ime set ${GBOARD_IME}`).catch(() => {});
}
