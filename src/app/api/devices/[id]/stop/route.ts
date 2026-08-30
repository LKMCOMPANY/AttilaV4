import { nativeRoute } from "@/lib/api/native-route";
import { stopContainerCore } from "@/lib/operator/device-control";

/** POST /api/devices/[id]/stop — stop the container (operator-initiated). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => stopContainerCore(ctx, id));
}
