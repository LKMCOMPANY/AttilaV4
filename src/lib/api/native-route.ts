import { NextResponse } from "next/server";
import { requireRequestSession, type RequestSession } from "@/lib/auth/session";

/**
 * Shared wrapper for the native REST surface (macOS app). Resolves the
 * caller from either transport (SSR cookie or `Authorization: Bearer`),
 * invokes the handler with the RLS-scoped `RequestSession`, and returns its
 * result as JSON. Handlers reuse the operator cores (`src/lib/operator/*`),
 * which report business failures as `{ error }` payloads with HTTP 200 —
 * exactly like the Server Actions — so only auth/transport failures map to
 * HTTP error statuses here.
 */
export async function nativeRoute(
  request: Request,
  handler: (ctx: RequestSession) => Promise<unknown>,
): Promise<NextResponse> {
  try {
    const ctx = await requireRequestSession(request);
    const result = await handler(ctx);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = message.includes("Forbidden")
      ? 403
      : message.includes("Unauthorized")
        ? 401
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/** Parse a JSON body, returning null (never throwing) on malformed input. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
