import { generateText } from "ai";
import { getAleriaModel } from "@/lib/ai/client";
import type { AnalystDecision } from "@/types";
import type { PipelinePost } from "./types";
import { pipelineLog, pipelineError, withTimeout } from "./types";
import { buildAnalystSystemPrompt, buildAnalystUserPrompt } from "./prompts";

const ANALYST_TIMEOUT_MS = 60_000;

/**
 * Analyze a post and decide: relevant? how many avatars?
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
): Promise<AnalystDecision> {
  const start = Date.now();

  try {
    const { text } = await withTimeout(
      generateText({
        model: getAleriaModel("aleria"),
        system: buildAnalystSystemPrompt(guideline),
        prompt: buildAnalystUserPrompt(post),
        maxOutputTokens: 2000,
      }),
      ANALYST_TIMEOUT_MS,
      "Analyst",
    );

    if (!text) {
      throw new Error("Analyst returned empty content — reasoning consumed all tokens");
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
      durationMs: Date.now() - start,
    });

    return parsed;
  } catch (err) {
    pipelineError("analyst", post.id, "Analysis failed", err);
    throw err;
  }
}

function parseAleriaJSON<T>(content: string): T {
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}
