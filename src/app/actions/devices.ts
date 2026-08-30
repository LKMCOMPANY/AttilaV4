"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireActionSession } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { syncDeviceDetailCore } from "@/lib/admin/box-sync";
import type { Device } from "@/types";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const assignDeviceSchema = z.object({
  deviceId: z.string().uuid(),
  accountId: z.string().uuid(),
});

const unassignDeviceSchema = z.object({
  deviceId: z.string().uuid(),
});

const updateTagsSchema = z.object({
  deviceId: z.string().uuid(),
  tags: z.array(z.string().min(1).max(50)).max(20),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getDevicesByBox(boxId: string): Promise<Device[]> {
  await requireAdmin();
  const parsed = z.string().uuid().safeParse(boxId);
  if (!parsed.success) return [];

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("devices")
    .select("*")
    .eq("box_id", boxId)
    .order("user_name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Device[];
}

export async function getDevice(id: string): Promise<Device | null> {
  await requireAdmin();
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return null;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("devices")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return null;
  return data as Device;
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

export async function assignDeviceToAccount(
  input: z.infer<typeof assignDeviceSchema>
): Promise<{ error: string | null }> {
  await requireAdmin();

  const parsed = assignDeviceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("devices")
    .update({ account_id: parsed.data.accountId })
    .eq("id", parsed.data.deviceId);

  if (error) return { error: error.message };

  revalidatePath("/admin/infrastructure");
  return { error: null };
}

export async function unassignDevice(
  input: z.infer<typeof unassignDeviceSchema>
): Promise<{ error: string | null }> {
  await requireAdmin();

  const parsed = unassignDeviceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("devices")
    .update({ account_id: null })
    .eq("id", parsed.data.deviceId);

  if (error) return { error: error.message };

  revalidatePath("/admin/infrastructure");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export async function updateDeviceTags(
  input: z.infer<typeof updateTagsSchema>
): Promise<{ error: string | null }> {
  await requireAdmin();

  const parsed = updateTagsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("devices")
    .update({ tags: parsed.data.tags })
    .eq("id", parsed.data.deviceId);

  if (error) return { error: error.message };

  revalidatePath("/admin/infrastructure");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Sync single device detail — cookie-transport wrapper around
// `src/lib/admin/box-sync.ts` (also behind `/api/admin/devices/[id]/sync`).
// ---------------------------------------------------------------------------

export async function syncDeviceDetail(
  deviceId: string
): Promise<{ error: string | null }> {
  try {
    const ctx = await requireActionSession();
    const result = await syncDeviceDetailCore(ctx, deviceId);
    if (!result.error) revalidatePath("/admin/infrastructure");
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}
