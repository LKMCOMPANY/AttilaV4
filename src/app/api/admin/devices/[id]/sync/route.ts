import { nativeRoute } from "@/lib/api/native-route";
import { syncDeviceDetailCore } from "@/lib/admin/box-sync";

/**
 * POST /api/admin/devices/[id]/sync — refresh one device's hardware/network/
 * proxy detail from the live box API. Admin only (re-asserted in the core).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => syncDeviceDetailCore(ctx, id));
}
