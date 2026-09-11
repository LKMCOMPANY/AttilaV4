import { nativeRoute, readJsonBody } from "@/lib/api/native-route";
import { requestDirectedActionCore } from "@/lib/operator/directed-actions";

/**
 * POST /api/actions/directed — a human's order: like, follow or comment on
 * one target, by one avatar (now) or an army (spread over hours, in the
 * devices' active hours, never two avatars of one box in the same minute).
 * Body: `{ platform, action, target_url, text?, avatar_id? | army_id?,
 * spread_hours? }`. Queues `directed_action` tasks the Maintain loop runs
 * with the engine; answers the queued tasks and the avatars skipped, with
 * the reason.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  return nativeRoute(request, (ctx) => requestDirectedActionCore(ctx, body));
}
