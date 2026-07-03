import { generateText, type ModelMessage, type UserContent } from "ai";
import { getAleriaModel } from "@/lib/ai/client";
import type { WriterInput, WriterResult } from "./types";
import { pipelineLog, pipelineError, withTimeout } from "./types";
import { buildWriterSystemPrompt, buildWriterUserPrompt, postProcessComment, validateComment } from "./prompts";

const WRITER_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 1;

// aleria-vl reasons before answering, and `reasoning_content` counts against
// the completion budget. The persona-driven writer task reasons LONG —
// observed >2500 tokens on a routine TikTok comment, which starved the
// answer entirely. 6000 gives ~2x the worst observed chain (cost ≈ $0.01).
const WRITER_MAX_TOKENS = 6000;

/**
 * Generate a comment for a single avatar on a single post.
 * Called sequentially per avatar to accumulate cumulative context.
 *
 * Runs on `aleria-vl` with the post's still image attached when available,
 * so comments react to what's actually IN the video/photo instead of just
 * the caption. The retry attempt drops the image — if the first call choked
 * on the payload, text-only still produces a usable comment.
 */
export async function writeComment(input: WriterInput): Promise<WriterResult> {
  const { post, avatar, platform, guideline, previousCommentsOnPost, recentAvatarComments, postImage } = input;
  const start = Date.now();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const image = attempt === 0 ? postImage ?? null : null;
      const content: UserContent = [
        {
          type: "text",
          text: buildWriterUserPrompt(post, previousCommentsOnPost, recentAvatarComments, Boolean(image)),
        },
      ];
      if (image) {
        content.push({ type: "image", image: image.data, mediaType: image.mediaType });
      }
      const messages: ModelMessage[] = [{ role: "user", content }];

      const { text } = await withTimeout(
        generateText({
          model: getAleriaModel("aleria-vl"),
          system: buildWriterSystemPrompt(avatar, platform, guideline),
          messages,
          maxOutputTokens: WRITER_MAX_TOKENS,
        }),
        WRITER_TIMEOUT_MS,
        "Writer",
      );

      if (!text) {
        throw new Error("Writer returned empty text — reasoning consumed all tokens");
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
        withImage: Boolean(image),
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
