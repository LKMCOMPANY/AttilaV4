import { nativeRoute } from "@/lib/api/native-route";
import { toggleScreenWakeCore } from "@/lib/operator/device-control";

/** POST /api/devices/[id]/wake — toggle the device screen wake/sleep. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => toggleScreenWakeCore(ctx, id));
}
