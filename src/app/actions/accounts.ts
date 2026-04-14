"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Account, AccountStatus, AccountWithUsers } from "@/types";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createAccountSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
});

const updateAccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
});

const updateStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["active", "standby", "archived"]),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getAccounts(): Promise<AccountWithUsers[]> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("*, profiles(*)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (accounts ?? []).map((account) => ({
    ...account,
    profiles: account.profiles ?? [],
    user_count: (account.profiles ?? []).length,
  })) as AccountWithUsers[];
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createAccount(
  input: z.infer<typeof createAccountSchema>
): Promise<{ data: Account | null; error: string | null }> {
  await requireAdmin();

  const parsed = createAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
    })
    .select()
    .single();

  if (error) return { data: null, error: error.message };

  revalidatePath("/admin/accounts");
  return { data: data as Account, error: null };
}

export async function updateAccount(
  input: z.infer<typeof updateAccountSchema>
): Promise<{ error: string | null }> {
  await requireAdmin();

  const parsed = updateAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { id, ...fields } = parsed.data;
  const updates: Record<string, unknown> = {};
  if (fields.name !== undefined) updates.name = fields.name;
  if (fields.description !== undefined) updates.description = fields.description;

  if (Object.keys(updates).length === 0) return { error: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("accounts")
    .update(updates)
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/admin/accounts");
  return { error: null };
}

export async function updateAccountStatus(
  input: z.infer<typeof updateStatusSchema>
): Promise<{ error: string | null }> {
  await requireAdmin();

  const parsed = updateStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("accounts")
    .update({ status: parsed.data.status as AccountStatus })
    .eq("id", parsed.data.id);

  if (error) return { error: error.message };

  revalidatePath("/admin/accounts");
  return { error: null };
}
