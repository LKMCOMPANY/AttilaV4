import type { RequestSession } from "@/lib/auth/session";
import { resolveDeviceAccess } from "@/lib/devices/access";
import { getCfHeaders } from "@/lib/box-api";

/**
 * Stream-access broker — the ONLY place a native client obtains the means to
 * connect directly to a box's Cloudflare tunnel.
 *
 * The web operator streams through `server.mjs` (`/ws/stream/…`), which keeps
 * the CF-Access service credentials server-side. The native macOS app connects
 * to `wss://{box}/stream/{dbId}/…` DIRECTLY (no Render hop → lower latency), so
 * it needs a credential it can present itself. We mint a short-lived Cloudflare
 * Access **service-token session** cookie (`CF_Authorization`) here and hand it
 * to the caller; the long-lived `CF_ACCESS_CLIENT_ID/SECRET` never leave the
 * server. Access is re-checked per device (`resolveDeviceAccess`) before a token
 * is ever issued, so the broker cannot widen a caller's reach.
 *
 * The Access application is a wildcard over `*.attila.army`, so a single minted
 * cookie authenticates every box in the fleet — we cache it process-wide and
 * refresh a bit before expiry instead of minting one per request.
 */

export interface StreamAccessResult {
  error: string | null;
  /** The `CF_Authorization` JWT to send as a cookie on the direct box connection. */
  token?: string;
  /** Absolute expiry (epoch ms) so the client can refresh before it lapses. */
  expiresAt?: number;
  /** The device's box tunnel host, e.g. `box-4.attila.army`. */
  boxHostname?: string;
  /** VMOS container id — the stream path key (`/stream/{dbId}/video`). */
  dbId?: string;
}

interface CfToken {
  token: string;
  expiresAt: number;
}

// Refresh the fleet cookie this long before its real expiry so a token handed
// to a client is always comfortably valid for the length of a session.
const REFRESH_MARGIN_MS = 60 * 60 * 1000; // 1 hour
// Fallback lifetime when the JWT carries no decodable `exp` (never observed in
// practice — the CF cookie is ~24h — but we must never hand out an unbounded token).
const FALLBACK_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const MINT_TIMEOUT_MS = 15_000;

// Process-wide fleet-token cache + single-flight guard. Render may run several
// instances; each keeps its own cache, which is fine — the cookie is stateless.
let cachedToken: CfToken | null = null;
let inFlight: Promise<CfToken> | null = null;

/** Decode a JWT's `exp` (seconds) into epoch ms without verifying the signature. */
function decodeJwtExpiry(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Pull the `CF_Authorization` value out of a `Set-Cookie` header list. */
function extractCfAuthorization(setCookies: string[]): string | null {
  for (const cookie of setCookies) {
    const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Mint a fresh fleet cookie by presenting the service token to any box behind
 * the Access application. Cloudflare authenticates the service token and returns
 * a `CF_Authorization` session cookie valid across the wildcard app.
 */
async function mintCfToken(tunnelHostname: string): Promise<CfToken> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MINT_TIMEOUT_MS);
  try {
    const res = await fetch(`https://${tunnelHostname}/healthz`, {
      headers: getCfHeaders(),
      cache: "no-store",
      signal: controller.signal,
      redirect: "manual",
    });
    const setCookies = res.headers.getSetCookie();
    const token = extractCfAuthorization(setCookies);
    if (!token) {
      throw new Error("Cloudflare Access did not return a session cookie");
    }
    const decoded = decodeJwtExpiry(token);
    const expiresAt = decoded ?? Date.now() + FALLBACK_TTL_MS;
    return { token, expiresAt };
  } finally {
    clearTimeout(timer);
  }
}

/** Return a cached fleet cookie, refreshing (single-flight) when near expiry. */
async function getFleetToken(tunnelHostname: string): Promise<CfToken> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return cachedToken;
  }
  if (inFlight) return inFlight;

  inFlight = mintCfToken(tunnelHostname)
    .then((token) => {
      cachedToken = token;
      return token;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * Resolve a device (enforcing per-device access), then return a fleet cookie
 * plus the coordinates the native client needs to open the direct stream.
 * Transport/auth failures throw (mapped to 401/403 by `nativeRoute`); a failure
 * to mint the cookie comes back as an `{ error }` payload like the other cores.
 */
export async function mintStreamAccessCore(
  ctx: RequestSession,
  deviceId: string,
): Promise<StreamAccessResult> {
  const { dbId, tunnelHostname } = await resolveDeviceAccess(ctx, deviceId);

  try {
    const { token, expiresAt } = await getFleetToken(tunnelHostname);
    return { error: null, token, expiresAt, boxHostname: tunnelHostname, dbId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}
