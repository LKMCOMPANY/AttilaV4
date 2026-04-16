import type { CampaignPlatform } from "@/types";
import type { ExecutionResult } from "./types";
import { pipelineLog, pipelineError } from "./types";
import { postReply } from "@/lib/automation/x-reply";
import { postTikTokComment } from "@/lib/automation/tiktok-reply";

/**
 * Execute an ADB automation on a device. Thin wrapper around the shared
 * automation modules in src/lib/automation/ — no duplicated ADB logic.
 *
 * Additional validation: if source and proof screenshots are identical
 * (same byte length), the post almost certainly didn't go through.
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

  try {
    if (platform === "twitter") {
      const result = await postReply(tunnelHostname, dbId, postUrl, commentText);

      const screenshotMatch = detectIdenticalScreenshots(
        result.source,
        result.proof,
      );

      pipelineLog("execute", jobId, `Twitter result`, {
        success: result.success,
        mode: result.mode,
        error: result.error,
        screenshotMatch,
        durationMs: result.durationMs,
        sourceBytes: result.source?.length ?? 0,
        proofBytes: result.proof?.length ?? 0,
      });

      if (result.success && screenshotMatch) {
        return {
          success: false,
          mode: result.mode,
          sourceScreenshot: result.source,
          proofScreenshot: result.proof,
          error: "Proof screenshot identical to source — reply likely not posted",
          durationMs: result.durationMs,
        };
      }

      return {
        success: result.success,
        mode: result.mode,
        sourceScreenshot: result.source,
        proofScreenshot: result.proof,
        error: result.error,
        durationMs: result.durationMs,
      };
    }

    const result = await postTikTokComment(tunnelHostname, dbId, postUrl, commentText);

    const screenshotMatch = detectIdenticalScreenshots(
      result.source,
      result.proof,
    );

    pipelineLog("execute", jobId, `TikTok result`, {
      success: result.success,
      error: result.error,
      screenshotMatch,
      durationMs: result.durationMs,
      sourceBytes: result.source?.length ?? 0,
      proofBytes: result.proof?.length ?? 0,
    });

    if (result.success && screenshotMatch) {
      return {
        success: false,
        mode: "app",
        sourceScreenshot: result.source,
        proofScreenshot: result.proof,
        error: "Proof screenshot identical to source — comment likely not posted",
        durationMs: result.durationMs,
      };
    }

    return {
      success: result.success,
      mode: "app",
      sourceScreenshot: result.source,
      proofScreenshot: result.proof,
      error: result.error,
      durationMs: result.durationMs,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    pipelineError("execute", jobId, "Execution CRASHED", err);
    return { success: false, error, durationMs: Date.now() - start };
  }
}

/**
 * Two screenshots with the same byte length on a live Android screen
 * almost certainly mean the page did not change between captures.
 * Both must be non-empty for the comparison to be meaningful.
 */
function detectIdenticalScreenshots(
  source: Buffer | undefined,
  proof: Buffer | undefined,
): boolean {
  if (!source || !proof) return false;
  if (source.length === 0 || proof.length === 0) return false;
  return source.length === proof.length;
}
