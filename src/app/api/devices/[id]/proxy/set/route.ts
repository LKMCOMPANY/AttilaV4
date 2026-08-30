import { nativeRoute, readJsonBody } from "@/lib/api/native-route";
import { updateDeviceProxyCore, type UpdateProxyInput } from "@/lib/operator/device-proxy";

/**
 * POST /api/devices/[id]/proxy/set — provision the proxy on the device and
 * persist it. Body: `{ proxyType, host, port, account?, password? }` (an empty
 * password on an existing auth-proxy means "keep current"). Validation happens
 * in the core's zod schema.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await readJsonBody(request)) as Record<string, unknown> | null;
  const input = { ...(body ?? {}), deviceId: id } as UpdateProxyInput;
  return nativeRoute(request, (ctx) => updateDeviceProxyCore(ctx, input));
}
