import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

let _provider: ReturnType<typeof createOpenAICompatible> | null = null;

function getAleria() {
  if (_provider) return _provider;

  const baseURL = process.env.ALERIA_BASE_URL;
  const apiKey = process.env.ALERIA_API_KEY;

  if (!baseURL || !apiKey) {
    throw new Error("Missing ALERIA_BASE_URL or ALERIA_API_KEY env vars");
  }

  _provider = createOpenAICompatible({ name: "aleria", baseURL, apiKey });
  return _provider;
}

export function getAleriaModel(modelId: "aleria" | "aleria-vl" = "aleria") {
  return getAleria().chatModel(modelId);
}
