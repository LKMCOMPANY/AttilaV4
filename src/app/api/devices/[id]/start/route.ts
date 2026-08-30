import { nativeRoute } from "@/lib/api/native-route";
import { startContainerCore } from "@/lib/operator/device-control";

/**
 * POST /api/devices/[id]/start — start the container (capacity-aware).
 * May answer `{ atCapacity: true, max, running }` when the box is full and
 * no idle device could be auto-closed.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => startContainerCore(ctx, id));
}
