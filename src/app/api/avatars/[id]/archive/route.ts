import { nativeRoute } from "@/lib/api/native-route";
import { archiveAvatarCore } from "@/lib/operator/avatar-archive";

/**
 * POST /api/avatars/[id]/archive — soft-delete: detaches the device, cancels
 * queued jobs, hides the avatar from the active list. Manager+ only.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => archiveAvatarCore(ctx, id));
}
