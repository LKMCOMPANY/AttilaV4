import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types";

export async function getSession() {
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

  return {
    claims: data.claims,
    profile: profile as UserProfile,
  };
}

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function requireAdmin() {
  const session = await requireSession();
  if (session.profile.role !== "admin") {
    throw new Error("Forbidden: admin access required");
  }
  return session;
}
