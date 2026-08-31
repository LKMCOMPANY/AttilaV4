import { nativeRoute } from "@/lib/api/native-route";
import { purgeAwaitingPostsCore } from "@/lib/automator/pipeline-admin";

/**
 * POST /api/campaigns/[id]/awaiting/purge — park every `awaiting_avatars`
 * post of the campaign as `filtered_out` (admin only; native transport of
 * the `purgeAwaitingPosts` server action). Answers `{ count }`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nativeRoute(request, async (ctx) => ({
    count: await purgeAwaitingPostsCore(ctx, id),
  }));
}
