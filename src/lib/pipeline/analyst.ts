import { generateText, type ModelMessage, type UserContent } from "ai";
import { getAleriaModel } from "@/lib/ai/client";
import { parseAleriaJSON } from "@/lib/ai/aleria-json";
import type { AnalystDecision } from "@/types";
import type { PipelinePost } from "./types";
import type { PostImage } from "./post-image";
import { pipelineLog, pipelineError, withTimeout } from "./types";
import { buildAnalystSystemPrompt, buildAnalystUserPrompt } from "./prompts";

// Aleria latency is normally 5-18s but degrades under load (observed 44s for a
// trivial prompt). Give the analyst generous headroom — a post that times out
// is re-queued by the processor (transient), so a higher ceiling mainly avoids
// churning the retry budget during a slow spell. Overridable via env.
const ANALYST_TIMEOUT_MS = Number(process.env.ANALYST_TIMEOUT_MS ?? 90_000);

// aleria-vl is a reasoner: `reasoning_content` counts against the completion
// budget, and image reasoning runs long (~1k tokens observed on a trivial
// cover). Too low a ceiling starves the actual JSON answer.
const ANALYST_MAX_TOKENS = 4000;

/**
 * Analyze a post and decide: relevant? how many avatars?
 *
 * Runs on `aleria-vl` (vision) with the post's still image attached when one
 * was harvestable — TikTok captions are frequently just hashtags, so the
 * cover frame is where the actual subject lives. If the vision call fails
 * with an image attached, we retry once text-only before surfacing the error
 * (a broken image must never cost us the post).
 *
 * Uses generateText + JSON parsing instead of Output.object() because
 * Aleria doesn't support the responseFormat/structuredOutputs feature
 * that the AI SDK sends for Output.object().
 */
export async function analyzePost(
  post: PipelinePost,
  guideline: {
    operational_context: string | null;
    strategy: string | null;
    key_messages: string | null;
  },
  image?: PostImage | null,
): Promise<AnalystDecision> {
  const start = Date.now();

  try {
    let text: string;
    try {
      text = await callAnalyst(post, guideline, image ?? null);
    } catch (err) {
      if (!image) throw err;
      pipelineLog("analyst", post.id, "Vision call failed — retrying text-only", {
        error: err instanceof Error ? err.message : String(err),
      });
      text = await callAnalyst(post, guideline, null);
    }

    const parsed = parseAleriaJSON<AnalystDecision>(text);

    if (typeof parsed.relevant !== "boolean" || typeof parsed.reason !== "string") {
      throw new Error(`Invalid analyst response shape: ${text.slice(0, 200)}`);
    }

    parsed.suggested_avatar_count = Math.max(1, Math.min(5, parsed.suggested_avatar_count ?? 1));

    pipelineLog("analyst", post.id, "Decision", {
      relevant: parsed.relevant,
      reason: parsed.reason,
      avatars: parsed.suggested_avatar_count,
      withImage: Boolean(image),
      durationMs: Date.now() - start,
    });

    return parsed;
  } catch (err) {
    pipelineError("analyst", post.id, "Analysis failed", err);
    throw err;
  }
}

async function callAnalyst(
  post: PipelinePost,
  guideline: {
    operational_context: string | null;
    strategy: string | null;
    key_messages: string | null;
  },
  image: PostImage | null,
): Promise<string> {
  const content: UserContent = [
    { type: "text", text: buildAnalystUserPrompt(post, Boolean(image)) },
  ];
  if (image) {
    content.push({ type: "image", image: image.data, mediaType: image.mediaType });
  }
  const messages: ModelMessage[] = [{ role: "user", content }];

  const { text } = await withTimeout(
    generateText({
      model: getAleriaModel("aleria-vl"),
      system: buildAnalystSystemPrompt(guideline),
      messages,
      maxOutputTokens: ANALYST_MAX_TOKENS,
    }),
    ANALYST_TIMEOUT_MS,
    "Analyst",
  );

  if (!text) {
    throw new Error("Analyst returned empty content — reasoning consumed all tokens");
  }
  return text;
}
