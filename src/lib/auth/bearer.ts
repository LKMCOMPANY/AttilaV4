import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile, AccountStatus } from "@/types";
import type { Session } from "@/lib/auth/session";

/**
 * Bearer-JWT authentication for API routes called by native clients
 * (macOS app). The browser dashboard rides SSR cookies (`getSession`);
 * native apps send `Authorization: Bearer <access_token>` instead —
 * these helpers validate the token against Supabase Auth and load the
 * caller's profile under their own RLS scope (never service role).
 *
 * `authenticateBearer` mirrors the `getSession` gates exactly: a
 * non-admin whose account is missing or not `active` is rejected, so a
 * suspended tenant loses native access the same way it loses the web.
 */

export type BearerResult =
  | { ok: true; session: Session; supabase: SupabaseClient }
  | { ok: false; status: 401 | 403; error: string };

export async function authenticateBearer(request: Request): Promise<BearerResult> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token || token === header) {
    return { ok: false, status: 401, error: "Missing bearer token" };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return { ok: false, status: 401, error: "Auth backend not configured" };
  }

  // Publishable-key client pinned to the caller's JWT: every read below
  // (and any query the route runs afterwards) stays under the caller's RLS.
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return { ok: false, status: 401, error: "Invalid or expired token" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userData.user.id)
    .single();

  if (!profile) {
    return { ok: false, status: 401, error: "Profile not found" };
  }

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

  if (typedProfile.role !== "admin" && (!accountStatus || accountStatus !== "active")) {
    return { ok: false, status: 403, error: "Account is not active" };
  }

  const session: Session = {
    claims: { sub: userData.user.id, email: userData.user.email },
    profile: typedProfile,
    accountStatus,
  };

  return { ok: true, session, supabase };
}

export type BearerAdminResult =
  | { ok: true; profile: UserProfile }
  | { ok: false; status: 401 | 403; error: string };

export async function authenticateAdminBearer(
  request: Request
): Promise<BearerAdminResult> {
  const result = await authenticateBearer(request);
  if (!result.ok) return result;

  if (result.session.profile.role !== "admin") {
    return { ok: false, status: 403, error: "Forbidden: admin access required" };
  }

  return { ok: true, profile: result.session.profile };
}
