import { nativeRoute } from "@/lib/api/native-route";
import { resolveAttentionCore } from "@/lib/operator/attention";

/** POST /api/attention/[id]/resolve — admins and managers close an item on their authority. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => resolveAttentionCore(ctx, id));
}
