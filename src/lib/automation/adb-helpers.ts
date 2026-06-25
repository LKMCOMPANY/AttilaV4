/**
 * High-level Android helpers used by automation scripts (X, TikTok, …).
 *
 * Built on top of the shell primitives in `@/lib/box-api`. Helpers here:
 *   - assume the container has already passed `ensureContainerReady`
 *   - propagate `ContainerNotReadyError` if the device dies mid-flow
 *   - never silently ignore failures (use `shellSafe` for explicit cleanup)
 */

import { shell, shellSafe, ContainerNotReadyError } from "@/lib/box-api";
import { JobError } from "./errors";

const ADBKEYBOARD_PACKAGE = "com.android.adbkeyboard";
const ADBKEYBOARD_IME = "com.android.adbkeyboard/.AdbIME";

// VMOS forwards shell commands to Android through a Docker exec. While the
// container is mid-boot or its runtime is unhealthy, the exec itself fails and
// VMOS returns the Docker/runtime error as the command "output" with HTTP code
// 200 — so box-api's code-201 `ContainerNotReadyError` never fires. Detecting
// these signatures lets us re-raise as `ContainerNotReadyError` so the pipeline
// treats them as transient (retry) instead of a bug.
const EXEC_FAILURE_SIGNATURES = [
  "error response from daemon", // docker daemon refused the exec
  "exec failed", // OCI runtime exec failed
  "can't find service", // android system services not up yet (settings, ime…)
  "失败", // generic CN-locale failure from the VMOS exec layer (创建 exec 失败)
];

function adbLog(dbId: string, message: string, data?: Record<string, unknown>) {
  console.log(`[ADB][${dbId}] ${message}`, data ? JSON.stringify(data) : "");
}

/**
 * Re-raise a shell result as `ContainerNotReadyError` when its output is
 * actually a VMOS/Docker exec failure rather than real command output. Keeps
 * IME activation from misreporting a booting container as a setup/IME bug.
 */
function assertContainerReachable(dbId: string, cmd: string, message: string): void {
  const lower = message.toLowerCase();
  if (EXEC_FAILURE_SIGNATURES.some((sig) => lower.includes(sig))) {
    throw new ContainerNotReadyError(dbId, `${cmd} → ${message.trim().slice(0, 120)}`);
  }
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeShellText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}

// ---------------------------------------------------------------------------
// Polling utilities — used to replace fragile `sleep(N)` waits
// ---------------------------------------------------------------------------

interface PollOptions {
  timeoutMs: number;
  intervalMs?: number;
  label?: string;
}

async function poll<T>(
  fn: () => Promise<T | null>,
  predicate: (v: T) => boolean,
  { timeoutMs, intervalMs = 500, label = "poll" }: PollOptions,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | null = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last !== null && predicate(last)) return last;
    await sleep(intervalMs);
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms (last=${JSON.stringify(last)})`);
}

// ---------------------------------------------------------------------------
// Power state
// ---------------------------------------------------------------------------

async function isDeviceAwake(
  tunnelHostname: string,
  dbId: string,
): Promise<boolean> {
  const result = await shell(tunnelHostname, dbId, "dumpsys power | grep mWakefulness");
  return result.message.includes("Awake");
}

/**
 * Wake the device and dismiss the lock screen. Sends WAKEUP + MENU then
 * verifies wakefulness, retrying once with a swipe-up unlock if needed.
 */
export async function wakeDevice(
  tunnelHostname: string,
  dbId: string,
): Promise<void> {
  if (await isDeviceAwake(tunnelHostname, dbId)) return;

  adbLog(dbId, "wakeDevice: device asleep, sending WAKEUP + MENU");
  await shell(tunnelHostname, dbId, "input keyevent KEYCODE_WAKEUP");
  await sleep(500);
  await shell(tunnelHostname, dbId, "input keyevent KEYCODE_MENU");
  await sleep(800);

  if (await isDeviceAwake(tunnelHostname, dbId)) return;

  adbLog(dbId, "wakeDevice: still asleep, retrying with swipe unlock");
  await shell(tunnelHostname, dbId, "input keyevent KEYCODE_WAKEUP");
  await sleep(500);
  await shell(tunnelHostname, dbId, "input swipe 540 1800 540 800 300");
  await sleep(1000);

  if (!(await isDeviceAwake(tunnelHostname, dbId))) {
    throw new Error("Failed to wake device after retry");
  }
}

// ---------------------------------------------------------------------------
// Package introspection
// ---------------------------------------------------------------------------

export async function isPackageInstalled(
  tunnelHostname: string,
  dbId: string,
  packageName: string,
): Promise<boolean> {
  const result = await shell(tunnelHostname, dbId, `pm list packages ${packageName}`);
  return result.message.includes(`package:${packageName}`);
}

// ---------------------------------------------------------------------------
// Input methods (IME)
// ---------------------------------------------------------------------------

export async function getCurrentIme(
  tunnelHostname: string,
  dbId: string,
): Promise<string> {
  const result = await shell(tunnelHostname, dbId, "settings get secure default_input_method");
  assertContainerReachable(dbId, "settings get default_input_method", result.message);
  return result.message.trim();
}

// `ime enable` writes the secure `enabled_input_methods` setting asynchronously
// (InputMethodManagerService persists it a few hundred ms after the command
// returns). These bound the wait for that write to land before we `ime set`.
const IME_ENABLE_PROPAGATION_TIMEOUT_MS = 6000;
const IME_ENABLE_PROPAGATION_INTERVAL_MS = 400;

/**
 * Poll the enabled-IME list until ADBKeyboard appears. grep on-device because
 * `ime list -s` is verbose and gets truncated by the VMOS shell transport.
 */
async function waitForImeEnabled(
  tunnelHostname: string,
  dbId: string,
): Promise<void> {
  const deadline = Date.now() + IME_ENABLE_PROPAGATION_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    const result = await shell(tunnelHostname, dbId, "ime list -s | grep -i adbkeyboard");
    assertContainerReachable(dbId, "ime list -s", result.message);
    last = result.message;
    if (result.message.toLowerCase().includes("adbkeyboard")) return;
    await sleep(IME_ENABLE_PROPAGATION_INTERVAL_MS);
  }
  throw new Error(
    `ADBKeyboard did not enter the enabled IME list within ${IME_ENABLE_PROPAGATION_TIMEOUT_MS}ms after 'ime enable' (last='${last.trim().slice(0, 80)}')`,
  );
}

/**
 * Activate ADBKeyboard so `am broadcast -a ADB_INPUT_TEXT` can deliver text.
 *
 * Runtime contract (not just provisioning): VMOS clears the enabled-IME list on
 * every container restart and the APK ships disabled, so we re-`pm enable` +
 * `ime enable` on every job, then wait for the enable to propagate before
 * `ime set`. Skipping that wait makes `ime set` race the async settings write
 * and fail with "cannot be selected for user #0" — the historical top cause of
 * pipeline failures. Throws on any failure; calling code must abort.
 */
export async function activateAdbKeyboard(
  tunnelHostname: string,
  dbId: string,
): Promise<void> {
  // A missing APK is an operator-actionable setup gap, not a transient bug —
  // surface it with the right category instead of a misleading IME error.
  if (!(await isPackageInstalled(tunnelHostname, dbId, ADBKEYBOARD_PACKAGE))) {
    throw new JobError(
      "device_setup_required",
      `ADBKeyboard (${ADBKEYBOARD_PACKAGE}) not installed on device — run scripts/install-adbkeyboard.mjs`,
    );
  }

  const pmEnable = await shell(tunnelHostname, dbId, `pm enable ${ADBKEYBOARD_PACKAGE}`);
  assertContainerReachable(dbId, "pm enable", pmEnable.message);

  const enable = await shell(tunnelHostname, dbId, `ime enable ${ADBKEYBOARD_IME}`);
  assertContainerReachable(dbId, "ime enable", enable.message);

  await waitForImeEnabled(tunnelHostname, dbId);

  const setResult = await shell(tunnelHostname, dbId, `ime set ${ADBKEYBOARD_IME}`);
  assertContainerReachable(dbId, "ime set", setResult.message);
  if (setResult.message.includes("Unknown input method")) {
    throw new Error(`ADBKeyboard could not be selected even after enable propagated: ${setResult.message.trim()}`);
  }

  // Confirm via settings since `ime set` returns success even when ignored.
  const active = await getCurrentIme(tunnelHostname, dbId);
  if (active !== ADBKEYBOARD_IME) {
    throw new Error(`ADBKeyboard activation failed — current IME: ${active}`);
  }
}

/**
 * Restore a previously-captured IME id. Best-effort: never throws so it can
 * always run from a `finally` clause without masking the original error.
 * Logs but does not retry on failure to keep automation latency predictable.
 */
export async function restoreIme(
  tunnelHostname: string,
  dbId: string,
  imeId: string,
): Promise<void> {
  if (!imeId || imeId === ADBKEYBOARD_IME) return;
  const result = await shellSafe(tunnelHostname, dbId, `ime set ${imeId}`);
  if (!result || result.code !== 200 || result.message.includes("Unknown input method")) {
    adbLog(dbId, "restoreIme: failed", { target: imeId, output: result?.message });
  }
}

// ---------------------------------------------------------------------------
// Text input via ADBKeyboard broadcast
// ---------------------------------------------------------------------------

export async function typeText(
  tunnelHostname: string,
  dbId: string,
  text: string,
): Promise<void> {
  const escaped = escapeShellText(text);
  const result = await shell(
    tunnelHostname,
    dbId,
    `am broadcast -a ADB_INPUT_TEXT --es msg "${escaped}"`,
  );
  if (!result.message.includes("Broadcast completed")) {
    throw new Error(`Text broadcast not acknowledged: ${result.message.slice(0, 120)}`);
  }
}

// ---------------------------------------------------------------------------
// Window focus tracking — used to verify intents land on the right activity
// ---------------------------------------------------------------------------

export async function getCurrentFocus(
  tunnelHostname: string,
  dbId: string,
): Promise<string> {
  const result = await shell(tunnelHostname, dbId, "dumpsys window | grep mCurrentFocus");
  // example: mCurrentFocus=Window{8099aa1 u0 com.twitter.android/com.twitter.tweetdetail.TweetDetailActivity}
  return result.message.trim();
}

/**
 * Wait until the focused window matches `substring` (typically an activity
 * name fragment). Polls cheaply so 99% of cases settle in under 1s. Throws
 * on timeout with the last observed focus included.
 */
export async function waitForFocus(
  tunnelHostname: string,
  dbId: string,
  substring: string,
  timeoutMs = 15_000,
): Promise<string> {
  return poll<string>(
    () => getCurrentFocus(tunnelHostname, dbId).catch(() => null),
    (focus) => focus.includes(substring),
    { timeoutMs, intervalMs: 500, label: `waitForFocus("${substring}")` },
  );
}

// ---------------------------------------------------------------------------
// UI tree introspection — used by both Twitter and TikTok flows to detect
// blocking states (login screen, content unavailable, captcha…).
// ---------------------------------------------------------------------------

/**
 * Best-effort `uiautomator dump --compressed`. Returns the raw XML on
 * success, `null` when uiautomator is not in an idle state (typical when
 * a video is playing or an animation is mid-frame). Callers must treat a
 * `null` result as "could not verify" rather than "no match".
 */
export async function tryUiDump(
  tunnelHostname: string,
  dbId: string,
): Promise<string | null> {
  const result = await shellSafe(
    tunnelHostname,
    dbId,
    "uiautomator dump --compressed /sdcard/ui.xml > /dev/null 2>&1 && cat /sdcard/ui.xml",
  );
  if (!result || result.code !== 200) return null;
  if (result.message.includes("could not get idle state")) return null;
  if (!result.message.includes("<hierarchy")) return null;
  return result.message;
}

// ---------------------------------------------------------------------------
// Re-exports — convenience for automation modules so they import from a
// single place (every helper they need lives in `adb-helpers`).
// ---------------------------------------------------------------------------

export { shell, shellSafe, screenshot } from "@/lib/box-api";
