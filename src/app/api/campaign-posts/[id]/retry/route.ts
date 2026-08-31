import { nativeRoute } from "@/lib/api/native-route";
import { retryAwaitingPostCore } from "@/lib/automator/pipeline-admin";

/**
 * POST /api/campaign-posts/[id]/retry — re-run avatar selection + writer
 * for one `awaiting_avatars` post (admin only; native transport of the
 * `retryAwaitingPost` server action). Answers
 * `{ success, message, jobsCreated }` — business refusals ride HTTP 200.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => retryAwaitingPostCore(ctx, id));
}
