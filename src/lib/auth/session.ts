import { createClient } from "@/lib/supabase/server";
import type { UserProfile, AccountStatus } from "@/types";

interface Session {
  claims: Record<string, unknown>;
  profile: UserProfile;
  accountStatus: AccountStatus | null;
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

export async function requireBoxAccess(boxId: string): Promise<Session> {
  const session = await requireSession();
  if (session.profile.role === "admin") return session;

  const supabase = await createClient();
  const { count } = await supabase
    .from("devices")
    .select("*", { count: "exact", head: true })
    .eq("box_id", boxId)
    .eq("account_id", session.profile.account_id);

  if (!count || count === 0) {
    throw new Error("Forbidden: no access to this box");
  }
  return session;
}
