import { nativeRoute, readJsonBody } from "@/lib/api/native-route";
import { createCampaignCore, type CreateCampaignInput } from "@/lib/automator/campaigns";
import { createCampaignBodySchema } from "@/lib/validation/automator";

/**
 * POST /api/campaigns — create a campaign (native macOS transport of the
 * `createCampaign` server action). Answers `{ data: Campaign | null,
 * error: string | null }` — business refusals ride HTTP 200.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  return nativeRoute(request, async (ctx) => {
    const parsed = createCampaignBodySchema.safeParse(body);
    if (!parsed.success) {
      return { data: null, error: parsed.error.issues[0].message };
    }
    return createCampaignCore(ctx, parsed.data as CreateCampaignInput);
  });
}
