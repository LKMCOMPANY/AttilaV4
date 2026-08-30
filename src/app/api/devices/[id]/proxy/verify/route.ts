import { nativeRoute } from "@/lib/api/native-route";
import { verifyDeviceProxyCore } from "@/lib/operator/device-proxy";

/**
 * POST /api/devices/[id]/proxy/verify — read the proxy actually applied on
 * the device (resyncing the DB) and probe its real reachability.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => verifyDeviceProxyCore(ctx, id));
}
