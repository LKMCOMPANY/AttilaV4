import { nativeRoute, readJsonBody } from "@/lib/api/native-route";
import { readDeviceScreenCore } from "@/lib/operator/device-screen";

/**
 * POST /api/devices/[id]/screen — what the running device shows: the
 * accessibility tree compacted to actionable nodes, the engine's screen
 * classification, and optionally the JPEG screenshot.
 * Body: `{ include_screenshot?: boolean, max_nodes?: number }`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
  return nativeRoute(request, (ctx) =>
    readDeviceScreenCore(ctx, id, {
      includeScreenshot: body.include_screenshot === true,
      maxNodes: typeof body.max_nodes === "number" ? body.max_nodes : undefined,
    }),
  );
}
