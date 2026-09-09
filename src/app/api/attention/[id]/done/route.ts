import { nativeRoute } from "@/lib/api/native-route";
import { markAttentionDoneCore } from "@/lib/operator/attention";

/** POST /api/attention/[id]/done — the caller says it is fixed; a probe confirms. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => markAttentionDoneCore(ctx, id));
}
