import type { CampaignPlatform } from "@/types";
import type { ExecutionResult } from "./types";
import { pipelineLog, pipelineError } from "./types";
import { postReply } from "@/lib/automation/x-reply";
import { postTikTokComment } from "@/lib/automation/tiktok-reply";

/**
 * Execute an ADB automation on a device. Thin wrapper around the shared
 * automation modules in src/lib/automation/ — no duplicated ADB logic.
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
      pipelineLog("execute", jobId, `Twitter result`, {
        success: result.success,
        mode: result.mode,
        error: result.error,
        durationMs: result.durationMs,
        sourceBytes: result.source?.length ?? 0,
        proofBytes: result.proof?.length ?? 0,
      });
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
    pipelineLog("execute", jobId, `TikTok result`, {
      success: result.success,
      error: result.error,
      durationMs: result.durationMs,
      sourceBytes: result.source?.length ?? 0,
      proofBytes: result.proof?.length ?? 0,
    });
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
