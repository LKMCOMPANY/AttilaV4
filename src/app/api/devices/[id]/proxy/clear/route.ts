import { nativeRoute } from "@/lib/api/native-route";
import { clearDeviceProxyCore } from "@/lib/operator/device-proxy";

/** POST /api/devices/[id]/proxy/clear — disable the proxy on the device. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => clearDeviceProxyCore(ctx, id));
}
