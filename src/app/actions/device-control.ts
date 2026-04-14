"use server";

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { boxFetch } from "@/lib/box-api";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Internal: validate device access and return box info
// ---------------------------------------------------------------------------

interface DeviceAccess {
  deviceId: string;
  dbId: string;
  tunnelHostname: string;
}

async function requireDeviceAccess(deviceId: string): Promise<DeviceAccess> {
  const session = await requireSession();
  const parsed = z.string().uuid().safeParse(deviceId);
  if (!parsed.success) throw new Error("Invalid device ID");

  const supabase = await createClient();
  const { data: device, error } = await supabase
    .from("devices")
    .select("id, db_id, account_id, box_id, boxes(tunnel_hostname)")
    .eq("id", deviceId)
    .single();

  if (error || !device) throw new Error("Device not found");

  const box = device.boxes as unknown as { tunnel_hostname: string } | null;
  if (!box) throw new Error("Box not found for device");

  if (
    session.profile.role !== "admin" &&
    device.account_id !== session.profile.account_id
  ) {
    throw new Error("Forbidden: no access to this device");
  }

  return {
    deviceId: device.id,
    dbId: device.db_id,
    tunnelHostname: box.tunnel_hostname,
  };
}

// ---------------------------------------------------------------------------
// Toggle screen wake/sleep
// ---------------------------------------------------------------------------

export async function toggleScreenWake(
  deviceId: string
): Promise<{ error: string | null; awake: boolean | null }> {
  try {
    const { dbId, tunnelHostname } = await requireDeviceAccess(deviceId);

    const stateRes = await boxFetch<{
      code: number;
      data: { message: string };
    }>(tunnelHostname, `/android_api/v1/shell/${dbId}`, {
      method: "POST",
      body: JSON.stringify({ cmd: "dumpsys power | grep mWakefulness" }),
    });

    const isAwake = stateRes.data?.message?.includes("Awake") ?? false;
    const keyevent = isAwake ? 223 : 224; // 223=sleep, 224=wake

    await boxFetch(tunnelHostname, `/android_api/v1/shell/${dbId}`, {
      method: "POST",
      body: JSON.stringify({ cmd: `input keyevent ${keyevent}` }),
    });

    return { error: null, awake: !isAwake };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Unknown error",
      awake: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Start container
// ---------------------------------------------------------------------------

export async function startContainer(
  deviceId: string
): Promise<{ error: string | null }> {
  try {
    const { dbId, tunnelHostname } = await requireDeviceAccess(deviceId);

    await boxFetch(tunnelHostname, "/container_api/v1/run", {
      method: "POST",
      body: JSON.stringify({ db_ids: [dbId] }),
    });

    const supabase = await createClient();
    await supabase
      .from("devices")
      .update({ state: "running", last_seen: new Date().toISOString() })
      .eq("id", deviceId);

    revalidatePath("/dashboard/operator");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Stop container
// ---------------------------------------------------------------------------

export async function stopContainer(
  deviceId: string
): Promise<{ error: string | null }> {
  try {
    const { dbId, tunnelHostname } = await requireDeviceAccess(deviceId);

    await boxFetch(tunnelHostname, "/container_api/v1/stop", {
      method: "POST",
      body: JSON.stringify({ db_ids: [dbId] }),
    });

    const supabase = await createClient();
    await supabase
      .from("devices")
      .update({ state: "stopped", last_seen: new Date().toISOString() })
      .eq("id", deviceId);

    revalidatePath("/dashboard/operator");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Shell tap (for screenshot fallback click-to-tap)
// ---------------------------------------------------------------------------

export async function shellTap(
  deviceId: string,
  x: number,
  y: number
): Promise<{ error: string | null }> {
  try {
    const { dbId, tunnelHostname } = await requireDeviceAccess(deviceId);

    await boxFetch(tunnelHostname, `/android_api/v1/shell/${dbId}`, {
      method: "POST",
      body: JSON.stringify({ cmd: `input tap ${Math.round(x)} ${Math.round(y)}` }),
    });

    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}
