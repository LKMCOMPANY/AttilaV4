import type { CampaignPlatform } from "@/types";
import type { ExecutionResult } from "./types";
import { pipelineLog, pipelineError } from "./types";
import { postReply } from "@/lib/automation/x-reply";
import { postTikTokComment } from "@/lib/automation/tiktok-reply";
import { getCurrentIme, restoreIme } from "@/lib/automation/adb-helpers";
import { encodeJobError } from "@/lib/automation/errors";
import { ContainerNotReadyError } from "@/lib/box-api";

/**
 * Execute one ADB automation job and guarantee IME restoration.
 *
 * Responsibilities:
 *   - Capture the device's currently active IME *before* the automation so
 *     we can put it back afterwards. The `am broadcast -a ADB_INPUT_TEXT`
 *     trick used by the platform modules requires switching the default
 *     IME to ADBKeyboard, which would otherwise persist across jobs and
 *     show the "ADB Keyboard {ON}" banner to operators.
 *   - Dispatch to the platform-specific automation.
 *   - Restore the original IME from a `finally` block so the device is
 *     left in a clean state even when the automation throws or the host
 *     loses network mid-flow.
 *
 * Platform modules return `{ success: false, error }` for handled errors
 * and only throw for unrecoverable failures (e.g. ContainerNotReadyError).
 * Both paths trigger IME restore.
 */
export async function executeJob(params: {
  tunnelHostname: string;
  dbId: string;
  platform: CampaignPlatform;
  postUrl: string;
  commentText: string;
  jobId: string;
}): Promise<ExecutionResult> {
  const { tunnelHostname, dbId, platform, postUrl, commentText, jobId } = params;
  const start = Date.now();

  pipelineLog("execute", jobId, `Executing ${platform} job`, {
    dbId,
    boxHost: tunnelHostname,
    postUrl,
    commentPreview: commentText.slice(0, 60),
  });

  let originalIme: string | null = null;
  try {
    originalIme = await getCurrentIme(tunnelHostname, dbId);
  } catch (err) {
    // Container died right at job start — surface as a typed failure so
    // the dashboard can route this as a transient infra issue, not a bug.
    pipelineError("execute", jobId, "Failed to capture original IME", err);
    const wrapped = err instanceof ContainerNotReadyError
      ? err
      : new Error(err instanceof Error ? err.message : String(err));
    return {
      success: false,
      error: encodeJobError(wrapped),
      durationMs: Date.now() - start,
    };
  }

  try {
    const result = platform === "twitter"
      ? await postReply(tunnelHostname, dbId, postUrl, commentText)
      : await postTikTokComment(tunnelHostname, dbId, postUrl, commentText);

    pipelineLog("execute", jobId, `${platform} result`, {
      success: result.success,
      error: result.error,
      durationMs: result.durationMs,
      sourceBytes: result.source?.length ?? 0,
      proofBytes: result.proof?.length ?? 0,
    });

    // Platform modules already serialise their JobError into result.error
    // via their own catch. Re-encode any plain string just to be safe.
    return {
      success: result.success,
      sourceScreenshot: result.source,
      proofScreenshot: result.proof,
      error: result.error ? ensureEncoded(result.error) : undefined,
      durationMs: result.durationMs,
    };
  } catch (err) {
    pipelineError("execute", jobId, "Execution CRASHED", err);
    return {
      success: false,
      error: encodeJobError(err),
      durationMs: Date.now() - start,
    };
  } finally {
    if (originalIme) {
      await restoreIme(tunnelHostname, dbId, originalIme);
    }
  }
}

/**
 * Idempotent guard: if the error string already starts with `[category]` we
 * leave it alone, otherwise we slap the `unknown` category on it.
 */
function ensureEncoded(message: string): string {
  return /^\[[a-z_]+\]\s/.test(message) ? message : `[unknown] ${message}`;
}
