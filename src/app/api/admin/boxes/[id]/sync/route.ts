import { nativeRoute } from "@/lib/api/native-route";
import { syncBoxCore } from "@/lib/admin/box-sync";

/**
 * POST /api/admin/boxes/[id]/sync — refresh box status + discover/update its
 * devices from the live box API. Admin only (re-asserted in the core).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => syncBoxCore(ctx, id));
}
