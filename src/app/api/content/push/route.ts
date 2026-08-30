import { z } from "zod";
import { nativeRoute, readJsonBody } from "@/lib/api/native-route";
import { pushContentToDeviceCore } from "@/lib/operator/content-push";

const bodySchema = z.object({
  contentId: z.string().uuid(),
  deviceId: z.string().uuid(),
});

/**
 * POST /api/content/push — push an uploaded content item onto a device's
 * media folders (gallery/camera roll). Body: `{ contentId, deviceId }`.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  return nativeRoute(request, async (ctx) => {
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return { error: "Invalid contentId or deviceId" };
    return pushContentToDeviceCore(ctx, parsed.data.contentId, parsed.data.deviceId);
  });
}
