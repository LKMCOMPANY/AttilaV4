import { z } from "zod";
import { nativeRoute, readJsonBody } from "@/lib/api/native-route";
import { refreshDeviceStatesCore } from "@/lib/operator/device-refresh";

const bodySchema = z.object({ accountId: z.string().uuid() });

/**
 * POST /api/devices/refresh — reconcile the account's device states against
 * the live boxes and return the fresh map. Body: `{ accountId }`.
 * Response: `{ error: null, states: { [deviceId]: state } }`.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  return nativeRoute(request, async (ctx) => {
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return { error: "Invalid accountId", states: {} };
    const states = await refreshDeviceStatesCore(ctx, parsed.data.accountId);
    return { error: null, states };
  });
}
