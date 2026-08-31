import { NextResponse } from "next/server";
import { z } from "zod";
import { nativeRoute, readJsonBody } from "@/lib/api/native-route";
import { mintStreamAccessCore } from "@/lib/operator/stream-access";

const bodySchema = z.object({ deviceId: z.string().uuid() });

/**
 * POST /api/stream/token  { deviceId }
 *
 * Mints a short-lived Cloudflare Access session cookie for the caller to open
 * a DIRECT stream to the device's box (native macOS app). Bearer or SSR cookie
 * transport; access is re-checked per device inside the core. Returns
 * `{ token, expiresAt, boxHostname, dbId }`.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid device ID" }, { status: 400 });
  }
  return nativeRoute(request, (ctx) =>
    mintStreamAccessCore(ctx, parsed.data.deviceId),
  );
}
