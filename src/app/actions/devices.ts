"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  fetchContainerDetail,
  fetchTimezoneLocale,
  fetchProxyConfig,
} from "@/lib/box-api";
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
// Sync single device detail from box API
// ---------------------------------------------------------------------------

export async function syncDeviceDetail(
  deviceId: string
): Promise<{ error: string | null }> {
  await requireAdmin();
  const parsed = z.string().uuid().safeParse(deviceId);
  if (!parsed.success) return { error: "Invalid device ID" };

  const supabase = await createClient();

  const { data: device } = await supabase
    .from("devices")
    .select("*, boxes(tunnel_hostname)")
    .eq("id", deviceId)
    .single();

  if (!device) return { error: "Device not found" };

  const box = device.boxes as { tunnel_hostname: string } | null;
  if (!box) return { error: "Box not found for device" };

  const updates: Record<string, unknown> = {
    last_seen: new Date().toISOString(),
  };

  // Hardware detail works for both running (code 200) and stopped (code 201)
  let isRunning = false;
  try {
    const detail = await fetchContainerDetail(box.tunnel_hostname, device.db_id);
    if (detail) {
      isRunning = detail.status === "running";
      updates.state = isRunning ? "running" : "stopped";
      updates.image = detail.image;
      if (detail.aosp_version) updates.aosp_version = detail.aosp_version;
      updates.resolution = `${detail.width}x${detail.height}`;
      updates.memory_mb = detail.memory;
      updates.dpi = parseInt(detail.dpi, 10) || null;
      updates.fps = parseInt(detail.fps, 10) || null;
      if (detail.ip) updates.docker_ip = detail.ip;
    }
  } catch {
    return { error: "Failed to reach device on box" };
  }

  // Timezone and proxy only available on running devices
  if (isRunning) {
    const [tz, proxy] = await Promise.all([
      fetchTimezoneLocale(box.tunnel_hostname, device.db_id).catch(() => null),
      fetchProxyConfig(box.tunnel_hostname, device.db_id).catch(() => null),
    ]);

    if (tz) {
      updates.country = tz.country;
      updates.locale = tz.locale;
      updates.timezone = tz.timezone;
    }

    if (proxy) {
      updates.proxy_enabled = proxy.enabled;
      updates.proxy_host = proxy.ip;
      updates.proxy_port = proxy.port;
      updates.proxy_type = proxy.proxyType;
      updates.proxy_account = proxy.account;
      updates.proxy_password = proxy.password;
    }
  }

  const { error } = await supabase
    .from("devices")
    .update(updates)
    .eq("id", deviceId);

  if (error) return { error: error.message };

  revalidatePath("/admin/infrastructure");
  return { error: null };
}
