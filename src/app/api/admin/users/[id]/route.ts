import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminBearer } from "@/lib/auth/bearer";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserProfile } from "@/types";

export const runtime = "nodejs";

/**
 * Member-login deletion for the native macOS admin client. Mirrors the
 * `deleteUser` server action (Auth Admin delete, profile row cascades)
 * with one extra server-side guard: platform admins can never be
 * deleted through this surface.
 *
 * Envelope contract: 200 { error: string | null } · 400/401/403/404 { error }.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateAdminBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Target guard: the route only ever deletes member logins.
  const { data: target } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", id)
    .single();

  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if ((target as Pick<UserProfile, "id" | "role">).role === "admin") {
    return NextResponse.json(
      { error: "Platform admins cannot be deleted through this surface" },
      { status: 403 }
    );
  }

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    return NextResponse.json({ error: error.message });
  }

  return NextResponse.json({ error: null });
}
