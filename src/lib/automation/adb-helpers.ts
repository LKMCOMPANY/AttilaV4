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
import { parseUiNodes, type UiNode } from "./ui-tree";

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
// Runtime permissions
// ---------------------------------------------------------------------------

/**
 * Pre-grant runtime permissions so the target app never raises a blocking
 * system dialog ("Allow TikTok to take pictures…") mid-automation. These
 * dialogs belong to `com.android.permissioncontroller`, steal focus, and
 * swallow every subsequent tap — they were a top cause of jobs that looked
 * successful while nothing was posted.
 *
 * Best-effort by design: a permission the app doesn't declare (or that isn't
 * user-grantable on this AOSP build) makes `pm grant` fail harmlessly, so we
 * use `shellSafe` and never let a grant error abort the job. Verified on
 * AOSP 13 / box-1 (07/2026): granting CAMERA flips `granted=false → true`.
 */
export async function grantAppPermissions(
  tunnelHostname: string,
  dbId: string,
  packageName: string,
  permissions: readonly string[],
): Promise<void> {
  for (const permission of permissions) {
    await shellSafe(tunnelHostname, dbId, `pm grant ${packageName} ${permission}`);
  }
}

// ---------------------------------------------------------------------------
// Foreground app gate
// ---------------------------------------------------------------------------

/** True when the target package currently owns the focused window. */
export async function isForegroundApp(
  tunnelHostname: string,
  dbId: string,
  packageName: string,
): Promise<boolean> {
  const focus = await getCurrentFocus(tunnelHostname, dbId).catch(() => "");
  return focus.includes(packageName);
}

// ---------------------------------------------------------------------------
// Tap helpers
// ---------------------------------------------------------------------------

/** Tap a screen coordinate. Thin wrapper for readability at call sites. */
export async function tap(
  tunnelHostname: string,
  dbId: string,
  point: { x: number; y: number },
): Promise<void> {
  await shell(tunnelHostname, dbId, `input tap ${Math.round(point.x)} ${Math.round(point.y)}`);
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

/**
 * Wait until the window system has settled onto a REAL focused window (the
 * launcher/home), i.e. `mCurrentFocus` names a `Window{…}` rather than `null`.
 *
 * Right after `sys.boot_completed=1` a loaded host is still starting system
 * services and `mCurrentFocus` reads `null` for a while. Firing a deep link
 * into that window race makes the target app fail to reach the foreground
 * (verified on box-1: deep link fired pre-settle → app never foregrounds in
 * 40s; fired once `mCurrentFocus` is the launcher → foreground in ~5s). Gating
 * on a real focused window makes the launch adapt to the box's actual speed
 * instead of a fixed sleep.
 *
 * Best-effort: returns `false` on timeout rather than throwing — the caller's
 * launch-retry loop is the real backstop.
 */
export async function waitForSystemReady(
  tunnelHostname: string,
  dbId: string,
  timeoutMs = 30_000,
): Promise<boolean> {
  try {
    await poll<string>(
      () => getCurrentFocus(tunnelHostname, dbId).catch(() => null),
      (focus) => focus.includes("Window{") && !focus.includes("mCurrentFocus=null"),
      { timeoutMs, intervalMs: 1000, label: "waitForSystemReady" },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a safe `am start -a VIEW` deep-link command.
 *
 * Two problems this solves, both proven live on box-1 (07/2026):
 *   1. Gorgone stores TikTok SHARE urls with tracking query params
 *      (`?_r=1&u_code=…&source=h5_m`). Passed raw to the VMOS shell the `&`
 *      splits the command — the url is truncated at the first `&` and the
 *      trailing package qualifier is lost, so the intent lands on the For-You
 *      feed, not the target video (the comment panel then never opens).
 *   2. Even parsed whole, a share url with `u_code`/`source=h5_m` makes TikTok
 *      redirect to the FYP rather than the specific video.
 * So we deep-link to the CANONICAL url (origin + path, query/fragment dropped
 * — the video/tweet id lives in the path) and single-quote it. A clean
 * canonical url foregrounds the target in ~5s (measured); the share url fails.
 */
export function androidDeepLink(url: string, packageName?: string): string {
  let target = url;
  try {
    const u = new URL(url);
    target = u.origin + u.pathname;
  } catch {
    // Not a parseable URL — fall back to the raw value (still quoted below).
  }
  const quoted = `'${target.replace(/'/g, "'\\''")}'`;
  return `am start -a android.intent.action.VIEW -d ${quoted}${packageName ? ` ${packageName}` : ""}`;
}

/**
 * Fire a deep link and confirm the target window reaches the foreground,
 * re-firing the (cheap) `am start` if it doesn't within a per-attempt budget.
 *
 * On a loaded host the first launch can be swallowed while the system settles;
 * re-firing reliably lands it — far cheaper than failing the whole job and
 * cold-restarting the container (~120s on a slow box). Returns `true` once
 * `focusSubstring` owns `mCurrentFocus`, `false` if every attempt timed out
 * (the caller then classifies a blocker or fails as retryable).
 */
export async function relaunchUntilFocus(
  tunnelHostname: string,
  dbId: string,
  deepLinkCmd: string,
  focusSubstring: string,
  opts: { attempts?: number; perAttemptMs?: number; onRetry?: (attempt: number) => void } = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? 3;
  const perAttemptMs = opts.perAttemptMs ?? 25_000;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await shell(tunnelHostname, dbId, deepLinkCmd);
    try {
      await waitForFocus(tunnelHostname, dbId, focusSubstring, perAttemptMs);
      return true;
    } catch {
      if (attempt < attempts) opts.onRetry?.(attempt);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// UI tree introspection — used by both Twitter and TikTok flows to detect
// blocking states (login screen, content unavailable, captcha…).
// ---------------------------------------------------------------------------

const UI_DUMP_ATTEMPTS = 4;
const UI_DUMP_RETRY_MS = 900;

/**
 * `uiautomator dump --compressed` with bounded retry.
 *
 * uiautomator refuses to dump while the window is animating or a video is
 * mid-frame ("could not get idle state"), so a single attempt frequently
 * returns nothing on TikTok. That flakiness is exactly why the old
 * single-shot `tryUiDump` returned `null` so often — and why the caller then
 * (wrongly) treated "couldn't read the screen" as "success". Retrying a few
 * times turns most of those into a real dump; the split-out `dump` step and
 * `cat` (instead of `&&`) means a failed dump still lets us read any stale
 * file rather than masking the outcome.
 *
 * Returns the raw XML, or `null` only when every attempt failed. Callers must
 * treat `null` as "could not verify" — for a success check that means FAILURE,
 * never an optimistic pass.
 */
export async function dumpUiXml(
  tunnelHostname: string,
  dbId: string,
  attempts = UI_DUMP_ATTEMPTS,
): Promise<string | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await shellSafe(
      tunnelHostname,
      dbId,
      "uiautomator dump --compressed /sdcard/ui.xml 2>/dev/null; cat /sdcard/ui.xml 2>/dev/null",
    );
    if (result && result.code === 200 && result.message.includes("<hierarchy")) {
      return result.message;
    }
    if (attempt < attempts - 1) await sleep(UI_DUMP_RETRY_MS);
  }
  return null;
}

/**
 * Parsed variant of {@link dumpUiXml}. Returns the typed node list, or `null`
 * when the dump could not be captured. Preferred entry point for flows that
 * reason about on-screen elements (composer open, text landed, dialog present).
 */
export async function dumpUiNodes(
  tunnelHostname: string,
  dbId: string,
  attempts = UI_DUMP_ATTEMPTS,
): Promise<UiNode[] | null> {
  const xml = await dumpUiXml(tunnelHostname, dbId, attempts);
  return xml ? parseUiNodes(xml) : null;
}

/**
 * Back-compat alias for the legacy name. Same resilient implementation.
 * @deprecated prefer {@link dumpUiXml} / {@link dumpUiNodes}.
 */
export async function tryUiDump(
  tunnelHostname: string,
  dbId: string,
): Promise<string | null> {
  return dumpUiXml(tunnelHostname, dbId);
}

// ---------------------------------------------------------------------------
// Re-exports — convenience for automation modules so they import from a
// single place (every helper they need lives in `adb-helpers`).
// ---------------------------------------------------------------------------

export { shell, shellSafe, screenshot } from "@/lib/box-api";
// Only the UI-tree helpers the platform modules actually consume are re-exported
// here (so automation code has a single import surface). Pure/internal helpers
// like nodeCenter / normalizedIncludes stay private to `ui-tree`.
export {
  parseUiNodes,
  findCommentEditText,
  editTextContains,
  findInterstitialDismiss,
  isCommentsPanelOpen,
  countPostedMatches,
} from "./ui-tree";
