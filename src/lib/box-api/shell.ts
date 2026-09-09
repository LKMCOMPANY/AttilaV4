/**
 * Shell primitives on a running container (Android API v1) and the screenshot
 * read. All Android-specific helpers (wake, IME, text input, focus tracking)
 * live in `src/lib/automation/adb-helpers.ts` on top of these.
 */

import { boxFetch, boxFetchBytes } from "./fetch";
import type { VmosResponse, VmosShellData } from "./types";

/**
 * Thrown when VMOS reports the container is not running (code 201). All
 * Android shell calls are no-ops in that state — callers must abort the
 * automation rather than continue typing into a dead container.
 */
export class ContainerNotReadyError extends Error {
  constructor(
    public readonly dbId: string,
    public readonly cmd?: string,
  ) {
    super(
      `Container ${dbId} not ready (VMOS code 201)${cmd ? ` for cmd: ${cmd.slice(0, 80)}` : ""}`,
    );
    this.name = "ContainerNotReadyError";
  }
}

export interface ShellResult {
  code: number;
  message: string;
}

function logShell(
  dbId: string,
  ok: boolean,
  cmd: string,
  code: number,
  message: string,
  ms: number,
) {
  const tag = ok ? "OK" : "WARN";
  console.log(
    `[ADB][${dbId}] shell ${tag}`,
    JSON.stringify({
      cmd: cmd.length > 80 ? cmd.slice(0, 80) + "…" : cmd,
      code,
      output: message.length > 200 ? message.slice(0, 200) + "…" : message,
      ms,
    }),
  );
}

/**
 * Run a shell command on the device through VMOS. Throws
 * `ContainerNotReadyError` when VMOS reports the container is not running so
 * automation cannot silently proceed against a dead device.
 *
 * VMOS overloads code 201 for two very different cases:
 *   1. Container not running — `data.cmd` is absent because VMOS never even
 *      forwarded the request to Android. `msg` is something like
 *      "实例未运行" / "instance not running".
 *   2. Container running but the shell command itself failed (bad args,
 *      Android-level exception, non-zero exit). `data.cmd` echoes the
 *      command and `data.message` carries the stderr/exception text.
 *
 * Only case 1 is `ContainerNotReadyError`. Case 2 is returned as a normal
 * result (with code 201) so the caller — which has the platform context —
 * can decide how to react (typically wrap as a `JobError("ui_unexpected")`).
 */
export async function shell(
  tunnelHostname: string,
  dbId: string,
  cmd: string,
): Promise<ShellResult> {
  const start = Date.now();
  const res = await boxFetch<VmosResponse<VmosShellData>>(
    tunnelHostname,
    `/android_api/v1/shell/${dbId}`,
    {
      method: "POST",
      body: JSON.stringify({ id: dbId, cmd }),
    },
  );

  const code = res.code ?? -1;
  const message = res.data?.message ?? "";
  const ms = Date.now() - start;
  logShell(dbId, code === 200, cmd, code, message, ms);

  if (code === 201 && !res.data?.cmd) {
    // VMOS never reached the device — container is down (or the request
    // was malformed). Either way the automation cannot proceed.
    throw new ContainerNotReadyError(dbId, cmd);
  }
  return { code, message };
}

/**
 * Same as `shell` but never throws — returns null when the container is not
 * ready. Use exclusively for cleanup paths (e.g. IME restore) where a failure
 * to communicate must not mask the real error.
 */
export async function shellSafe(
  tunnelHostname: string,
  dbId: string,
  cmd: string,
): Promise<ShellResult | null> {
  try {
    return await shell(tunnelHostname, dbId, cmd);
  } catch {
    return null;
  }
}

/**
 * Fetch a fresh device screenshot as a JPEG buffer.
 *
 * Uses the VMOS `no_cache=true` screenshot option (Edge screenshots v2), which
 * bypasses the ~5s server-side cache so every call returns the current frame.
 * Verified on box-1..5 (07/2026): back-to-back reads return distinct frames
 * when the screen changes, so the SOURCE/PROOF automation captures are
 * reliable with no dedup.
 *
 * Returns an empty buffer on transport failure so a missing debug screenshot
 * never aborts the automation.
 */
const SCREENSHOT_TIMEOUT_MS = 15_000;

export async function screenshot(tunnelHostname: string, dbId: string): Promise<Buffer> {
  const start = Date.now();
  try {
    const res = await boxFetchBytes(
      tunnelHostname,
      `/container_api/v1/screenshots/${dbId}?no_cache=true`,
      SCREENSHOT_TIMEOUT_MS,
    );
    const ms = Date.now() - start;
    if (!res.ok) {
      console.error(
        `[ADB][${dbId}] screenshot FAILED`,
        JSON.stringify({ httpStatus: res.status, ms }),
      );
      return Buffer.alloc(0);
    }
    console.log(`[ADB][${dbId}] screenshot OK`, JSON.stringify({ bytes: res.body.length, ms }));
    return res.body;
  } catch (err) {
    console.error(
      `[ADB][${dbId}] screenshot FAILED`,
      JSON.stringify({
        error: err instanceof Error ? err.name : "unknown",
        ms: Date.now() - start,
      }),
    );
    return Buffer.alloc(0);
  }
}
