import { nativeRoute } from "@/lib/api/native-route";
import { acknowledgeAttentionCore } from "@/lib/operator/attention";

/** POST /api/attention/[id]/ack — the caller takes the item in charge. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => acknowledgeAttentionCore(ctx, id));
}
