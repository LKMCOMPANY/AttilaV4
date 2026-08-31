import { nativeRoute, readJsonBody } from "@/lib/api/native-route";
import { updateCampaignCore, type UpdateCampaignInput } from "@/lib/automator/campaigns";
import { updateCampaignBodySchema } from "@/lib/validation/automator";

/**
 * PATCH /api/campaigns/[id] — partial campaign update (native macOS
 * transport of the `updateCampaign` server action; also carries the
 * guidelines auto-update toggle and the AI-apply triple). Answers
 * `{ data: Campaign | null, error: string | null }`.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readJsonBody(request);
  return nativeRoute(request, async (ctx) => {
    const parsed = updateCampaignBodySchema.safeParse(body);
    if (!parsed.success) {
      return { data: null, error: parsed.error.issues[0].message };
    }
    return updateCampaignCore(ctx, id, parsed.data as UpdateCampaignInput);
  });
}
