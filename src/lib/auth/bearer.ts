import { createClient } from "@supabase/supabase-js";
import type { UserProfile } from "@/types";

/**
 * Bearer-JWT authentication for API routes called by native clients
 * (macOS app). The browser dashboard rides SSR cookies (`getSession`);
 * native apps send `Authorization: Bearer <access_token>` instead —
 * this helper validates the token against Supabase Auth and loads the
 * caller's profile under their own RLS scope.
 */
export type BearerAdminResult =
  | { ok: true; profile: UserProfile }
  | { ok: false; status: 401 | 403; error: string };

export async function authenticateAdminBearer(
  request: Request
): Promise<BearerAdminResult> {
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

  // Publishable-key client pinned to the caller's JWT: profile reads
  // below run under the caller's own RLS scope, never service role.
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
  if (typedProfile.role !== "admin") {
    return { ok: false, status: 403, error: "Forbidden: admin access required" };
  }

  return { ok: true, profile: typedProfile };
}
