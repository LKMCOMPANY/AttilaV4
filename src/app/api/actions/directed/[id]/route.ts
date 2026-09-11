import { nativeRoute } from "@/lib/api/native-route";
import { getDirectedRequestCore } from "@/lib/operator/directed-actions";

/** GET /api/actions/directed/[id] — the tasks of one order (`params.request_id`), with their outcomes and steps. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => getDirectedRequestCore(ctx, id));
}
