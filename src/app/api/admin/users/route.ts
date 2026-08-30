import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminBearer } from "@/lib/auth/bearer";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUserSchema } from "@/lib/validation/admin-users";
import type { UserProfile } from "@/types";

export const runtime = "nodejs";

/**
 * Member-login provisioning for the native macOS admin client.
 * Mirrors the `createUser` server action exactly (same schema, same
 * Auth Admin call, profile row created by the `handle_new_user`
 * trigger) — the service-role key never leaves this route.
 *
 * Envelope contract (native `AdminUsersService` parity):
 *   200 { data: UserProfile | null, error: string | null }
 *   400 invalid payload · 401/403 auth — { error }
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateAdminBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ data: null, error: auth.error }, { status: auth.status });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createUserSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { email, password, display_name, role, account_id } = parsed.data;

  const admin = createAdminClient();
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      role,
      account_id,
      display_name,
    },
  });

  // Business refusal (duplicate email, weak password…): 200 + error —
  // the native client surfaces the reason verbatim.
  if (authError) {
    return NextResponse.json({ data: null, error: authError.message });
  }

  // The `handle_new_user` trigger has created the profile row; read it
  // back under service role (the caller is already asserted admin).
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("*")
    .eq("id", authData.user.id)
    .single();

  if (profileError) {
    return NextResponse.json({ data: null, error: profileError.message });
  }

  return NextResponse.json({ data: profile as UserProfile, error: null });
}
