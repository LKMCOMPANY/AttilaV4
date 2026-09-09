import { nativeRoute } from "@/lib/api/native-route";
import { compileAvatarBriefCore } from "@/lib/operator/briefs";

/** POST /api/avatars/[id]/brief/compile — recompile this avatar's effective brief. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => compileAvatarBriefCore(ctx, id));
}
