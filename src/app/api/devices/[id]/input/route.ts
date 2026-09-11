import { nativeRoute, readJsonBody } from "@/lib/api/native-route";
import { deviceInputCore } from "@/lib/operator/device-input";

/**
 * POST /api/devices/[id]/input — one operator gesture on a running device,
 * answered with the screen after it. Body: `{ input: <gesture>,
 * override_reason?, include_screenshot?, max_nodes? }` where `input` is one
 * of tap / press / type (ADBKeyboard) / open_url / swipe — validated by the
 * core's zod schema. A security screen refuses without `override_reason`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
  return nativeRoute(request, (ctx) =>
    deviceInputCore(ctx, id, body.input, {
      overrideReason: typeof body.override_reason === "string" ? body.override_reason : undefined,
      includeScreenshot: body.include_screenshot === true,
      maxNodes: typeof body.max_nodes === "number" ? body.max_nodes : undefined,
      client: request.headers.get("x-attila-client"),
    }),
  );
}
