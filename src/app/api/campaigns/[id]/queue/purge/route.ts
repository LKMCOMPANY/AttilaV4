import { nativeRoute } from "@/lib/api/native-route";
import { purgeQueueCore } from "@/lib/automator/pipeline-admin";

/**
 * POST /api/campaigns/[id]/queue/purge — cancel every `ready` job of the
 * campaign (admin only; native transport of the `purgeQueue` server
 * action). Answers `{ count }`; a non-admin caller gets HTTP 403.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nativeRoute(request, async (ctx) => ({
    count: await purgeQueueCore(ctx, id),
  }));
}
