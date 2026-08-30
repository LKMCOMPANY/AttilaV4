import { z } from "zod";
import { nativeRoute, readJsonBody } from "@/lib/api/native-route";
import { resolveAvatarBlockCore } from "@/lib/operator/avatar-blocks";
import { SOCIAL_PLATFORMS } from "@/types";

const bodySchema = z.object({ platform: z.enum(SOCIAL_PLATFORMS) });

/**
 * POST /api/avatars/[id]/blocks/resolve — operator "Mark resolved": clears
 * the active block for (avatar, platform). Idempotent. Body: `{ platform }`.
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
    return resolveAvatarBlockCore(ctx, id, parsed.data.platform);
  });
}
