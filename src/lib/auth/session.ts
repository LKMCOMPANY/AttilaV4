import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { authenticateBearer } from "@/lib/auth/bearer";
import type { UserProfile, AccountStatus } from "@/types";

export interface Session {
  claims: Record<string, unknown>;
  profile: UserProfile;
  accountStatus: AccountStatus | null;
}

/**
 * Minimal device shape required to evaluate access. Both columns are queried
 * straight from the `devices` table so callers don't need to fetch more than
 * `id, box_id, account_id` to pass the check.
 */
export interface DeviceAccessInput {
  box_id: string;
  account_id: string | null;
}

/**
 * Caller identity + the RLS-scoped Supabase client it arrived with. The
 * operator cores (`src/lib/operator/*`) take this instead of building their
 * own client so the SAME logic serves both transports: SSR cookies (server
 * actions / browser) and `Authorization: Bearer` (native macOS app).
 */
export interface RequestSession {
  session: Session;
  supabase: SupabaseClient;
}

export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) return null;

  const userId = data.claims.sub;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (!profile) return null;

  const typedProfile = profile as UserProfile;
  let accountStatus: AccountStatus | null = null;

  if (typedProfile.account_id) {
    const { data: account } = await supabase
      .from("accounts")
      .select("status")
      .eq("id", typedProfile.account_id)
      .single();

    accountStatus = (account?.status as AccountStatus) ?? null;
  }

  if (
    typedProfile.role !== "admin" &&
    accountStatus &&
    accountStatus !== "active"
  ) {
    return null;
  }

  return {
    claims: data.claims,
    profile: typedProfile,
    accountStatus,
  };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (session.profile.role !== "admin") {
    throw new Error("Forbidden: admin access required");
  }
  return session;
}

/** RLS-scoped request context for server actions (SSR cookie transport). */
export async function requireActionSession(): Promise<RequestSession> {
  const session = await requireSession();
  return { session, supabase: await createClient() };
}

/**
 * Resolve the caller of an API route from either transport: native clients
 * send `Authorization: Bearer <Supabase access token>`, the browser rides SSR
 * cookies. Throws `Unauthorized` / `Forbidden: …` so `nativeRoute` can map
 * the failure to 401/403.
 */
export async function requireRequestSession(request: Request): Promise<RequestSession> {
  const header = request.headers.get("authorization");
  if (header && /^Bearer\s+/i.test(header)) {
    const result = await authenticateBearer(request);
    if (!result.ok) {
      throw new Error(result.status === 403 ? `Forbidden: ${result.error}` : "Unauthorized");
    }
    return { session: result.session, supabase: result.supabase };
  }
  return requireActionSession();
}

// ---------------------------------------------------------------------------
// Box / device access helpers
// ---------------------------------------------------------------------------
//
// A box (and the devices it hosts) can be granted to an account in TWO ways:
//   1. Box-level — a row in `account_boxes` (the whole box is shared)
//   2. Device-level — `devices.account_id` set on individual devices
//
// The Operator page (and its RLS policy `client_read_assigned_devices`) lists
// devices reachable via either path. Every server-side guard that gates
// device interaction MUST mirror that same union — checking only column #2
// silently 403s box-level shares (where `devices.account_id` is NULL).
//
// Both helpers accept the caller's RLS-scoped client (from `RequestSession`)
// so bearer-authenticated requests reuse their JWT-pinned client; when omitted
// they fall back to the SSR cookie client.
// ---------------------------------------------------------------------------

/**
 * Returns true when the caller is allowed to operate on the given box.
 * Admins always pass. Other roles need either an `account_boxes` link or
 * at least one device on the box assigned to their account.
 */
export async function canUserAccessBox(
  session: Session,
  boxId: string,
  client?: SupabaseClient,
): Promise<boolean> {
  if (session.profile.role === "admin") return true;
  if (!session.profile.account_id) return false;

  const supabase = client ?? (await createClient());
  const accountId = session.profile.account_id;

  const [boxLink, deviceLink] = await Promise.all([
    supabase
      .from("account_boxes")
      .select("box_id", { count: "exact", head: true })
      .eq("box_id", boxId)
      .eq("account_id", accountId),
    supabase
      .from("devices")
      .select("id", { count: "exact", head: true })
      .eq("box_id", boxId)
      .eq("account_id", accountId),
  ]);

  return (boxLink.count ?? 0) > 0 || (deviceLink.count ?? 0) > 0;
}

/**
 * Returns true when the caller can interact with the given device.
 * Cheap when the device is directly assigned to the user's account; otherwise
 * one extra `account_boxes` lookup confirms the box-level share.
 */
export async function canUserAccessDevice(
  session: Session,
  device: DeviceAccessInput,
  client?: SupabaseClient,
): Promise<boolean> {
  if (session.profile.role === "admin") return true;
  if (!session.profile.account_id) return false;
  if (device.account_id === session.profile.account_id) return true;

  const supabase = client ?? (await createClient());
  const { count } = await supabase
    .from("account_boxes")
    .select("box_id", { count: "exact", head: true })
    .eq("box_id", device.box_id)
    .eq("account_id", session.profile.account_id);

  return (count ?? 0) > 0;
}
