"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { UserProfile, UserRole } from "@/types";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createUserSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  display_name: z.string().min(1, "Name is required").max(100),
  role: z.enum(["manager", "operator"]),
  account_id: z.string().uuid("Invalid account"),
});

const updateUserSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().min(1).max(100).optional(),
  role: z.enum(["manager", "operator"]).optional(),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getUsersByAccount(
  accountId: string
): Promise<UserProfile[]> {
  await requireAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("account_id", accountId)
    .neq("role", "admin")
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as UserProfile[];
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createUser(
  input: z.infer<typeof createUserSchema>
): Promise<{ data: UserProfile | null; error: string | null }> {
  await requireAdmin();

  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.issues[0].message };
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

  if (authError) {
    return { data: null, error: authError.message };
  }

  const supabase = await createClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", authData.user.id)
    .single();

  if (profileError) {
    return { data: null, error: profileError.message };
  }

  revalidatePath("/admin/accounts");
  return { data: profile as UserProfile, error: null };
}

export async function updateUser(
  input: z.infer<typeof updateUserSchema>
): Promise<{ error: string | null }> {
  await requireAdmin();

  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { id, ...fields } = parsed.data;
  const updates: Record<string, unknown> = {};
  if (fields.display_name !== undefined) updates.display_name = fields.display_name;
  if (fields.role !== undefined) updates.role = fields.role as UserRole;

  if (Object.keys(updates).length === 0) return { error: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/admin/accounts");
  return { error: null };
}

export async function deleteUser(
  id: string
): Promise<{ error: string | null }> {
  await requireAdmin();

  if (!z.string().uuid().safeParse(id).success) {
    return { error: "Invalid user ID" };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(id);

  if (error) return { error: error.message };

  revalidatePath("/admin/accounts");
  return { error: null };
}
