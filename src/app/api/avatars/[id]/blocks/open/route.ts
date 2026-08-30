import { z } from "zod";
import { nativeRoute, readJsonBody } from "@/lib/api/native-route";
import { openAvatarBlockCore } from "@/lib/operator/avatar-blocks";
import { SOCIAL_PLATFORMS } from "@/types";

const bodySchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  note: z.string().trim().max(500).optional(),
});

/**
 * POST /api/avatars/[id]/blocks/open — manual guardrail: block the avatar on
 * a platform (the Automator skips it until someone marks it resolved).
 * Body: `{ platform, note? }`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readJsonBody(request);
  return nativeRoute(request, async (ctx) => {
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return { error: "Invalid platform" };
    return openAvatarBlockCore(ctx, id, parsed.data.platform, parsed.data.note);
  });
}
