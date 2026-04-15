import { generateText } from "ai";
import { getAleriaModel } from "@/lib/ai/client";
import type { WriterInput, WriterResult } from "./types";
import { pipelineLog, pipelineError, withTimeout } from "./types";
import { buildWriterSystemPrompt, buildWriterUserPrompt, postProcessComment, validateComment } from "./prompts";

const WRITER_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 1;

/**
 * Generate a comment for a single avatar on a single post.
 * Called sequentially per avatar to accumulate cumulative context.
 */
export async function writeComment(input: WriterInput): Promise<WriterResult> {
  const { post, avatar, platform, guideline, previousCommentsOnPost, recentAvatarComments } = input;
  const start = Date.now();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { text } = await withTimeout(
        generateText({
          model: getAleriaModel("aleria"),
          system: buildWriterSystemPrompt(avatar, platform, guideline),
          prompt: buildWriterUserPrompt(post, previousCommentsOnPost, recentAvatarComments),
          maxOutputTokens: 1000,
        }),
        WRITER_TIMEOUT_MS,
        "Writer",
      );

      if (!text) {
        throw new Error("Writer returned empty text — increase max_tokens");
      }

      const processed = postProcessComment(text, platform);
      const validation = validateComment(processed);

      if (!validation.valid && attempt < MAX_RETRIES) {
        pipelineLog("writer", post.id, `Validation failed (${validation.reason}), retrying`, {
          avatar: avatar.id,
          attempt,
        });
        lastError = new Error(`Validation: ${validation.reason}`);
        continue;
      }

      pipelineLog("writer", post.id, "Comment generated", {
        avatar: avatar.id,
        platform,
        length: processed.length,
        durationMs: Date.now() - start,
      });

      return { avatarId: avatar.id, commentText: processed };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        pipelineLog("writer", post.id, `Generation failed, retrying`, { avatar: avatar.id, attempt });
        continue;
      }
    }
  }

  pipelineError("writer", post.id, "All attempts failed", lastError);
  throw lastError ?? new Error("Writer failed");
}
