import { nativeRoute } from "@/lib/api/native-route";
import { heartbeatCore } from "@/lib/operator/device-control";

/** POST /api/devices/[id]/heartbeat — keep a streamed device's last_seen fresh. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => heartbeatCore(ctx, id));
}
