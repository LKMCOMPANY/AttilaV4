import { createClient } from "@/lib/supabase/server";
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
// ---------------------------------------------------------------------------

/**
 * Returns true when the caller is allowed to operate on the given box.
 * Admins always pass. Other roles need either an `account_boxes` link or
 * at least one device on the box assigned to their account.
 */
export async function canUserAccessBox(
  session: Session,
  boxId: string,
): Promise<boolean> {
  if (session.profile.role === "admin") return true;
  if (!session.profile.account_id) return false;

  const supabase = await createClient();
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
): Promise<boolean> {
  if (session.profile.role === "admin") return true;
  if (!session.profile.account_id) return false;
  if (device.account_id === session.profile.account_id) return true;

  const supabase = await createClient();
  const { count } = await supabase
    .from("account_boxes")
    .select("box_id", { count: "exact", head: true })
    .eq("box_id", device.box_id)
    .eq("account_id", session.profile.account_id);

  return (count ?? 0) > 0;
}

export async function requireBoxAccess(boxId: string): Promise<Session> {
  const session = await requireSession();
  if (await canUserAccessBox(session, boxId)) return session;
  throw new Error("Forbidden: no access to this box");
}
