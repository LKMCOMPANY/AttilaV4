import { nativeRoute } from "@/lib/api/native-route";
import { unarchiveAvatarCore } from "@/lib/operator/avatar-archive";

/**
 * POST /api/avatars/[id]/unarchive — restore an archived avatar. The device
 * is NOT re-attached (it may be in use elsewhere). Manager+ only.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => unarchiveAvatarCore(ctx, id));
}
