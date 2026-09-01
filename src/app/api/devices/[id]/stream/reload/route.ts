import { nativeRoute } from "@/lib/api/native-route";
import { reloadProjectionCore } from "@/lib/operator/device-control";

/**
 * POST /api/devices/[id]/stream/reload — restart the on-device screen
 * projection service.
 *
 * The remedy for `projection_dead`: Android is up, scrcpy is not. Two seconds,
 * against 30-90 s for the container restart that was previously the only way
 * out.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => reloadProjectionCore(ctx, id));
}
