import { nativeRoute, readJsonBody } from "@/lib/api/native-route";
import { generateGuidelinesCore, type GenerateGuidelinesInput } from "@/lib/automator/guidelines";

/**
 * POST /api/campaigns/guidelines/generate — AI guideline generation
 * (native macOS transport of the `generateCampaignGuidelines` server
 * action). Body is the discriminated union `{ mode: "saved", campaignId }`
 * or `{ mode: "draft", accountId, name, platforms, gorgoneZoneId }` —
 * validated by the core's zod schema. Long-running (LLM); answers
 * `{ data: GuidelineGenerationResult | null, error: string | null }`.
 * Does NOT persist — the client previews and applies via PATCH.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  return nativeRoute(request, (ctx) =>
    generateGuidelinesCore(ctx, body as GenerateGuidelinesInput),
  );
}
