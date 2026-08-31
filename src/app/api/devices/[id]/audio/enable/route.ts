import { nativeRoute } from "@/lib/api/native-route";
import { enableAudioCore } from "@/lib/operator/device-control";

/** POST /api/devices/[id]/audio/enable — start the on-device scrcpy audio process. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => enableAudioCore(ctx, id));
}
