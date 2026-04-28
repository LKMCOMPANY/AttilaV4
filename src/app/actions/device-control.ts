"use server";

import { createClient } from "@/lib/supabase/server";
import { canUserAccessDevice, requireSession } from "@/lib/auth/session";
import { broadcastAccountEvent } from "@/lib/supabase/realtime";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ensureContainerReady,
  shell,
  shellSafe,
  stopContainer as stopContainerVmos,
} from "@/lib/box-api";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Internal: resolve a device, validate access, return everything needed for
// VMOS calls + downstream realtime fan-out.
// ---------------------------------------------------------------------------

interface DeviceAccess {
  deviceId: string;
  dbId: string;
  accountId: string | null;
  boxId: string;
  tunnelHostname: string;
}

async function resolveDeviceAccess(deviceId: string): Promise<DeviceAccess> {
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

  const allowed = await canUserAccessDevice(session, {
    box_id: device.box_id,
    account_id: device.account_id as string | null,
  });
  if (!allowed) throw new Error("Forbidden: no access to this device");

  return {
    deviceId: device.id,
    dbId: device.db_id,
    accountId: device.account_id as string | null,
    boxId: device.box_id,
    tunnelHostname: box.tunnel_hostname,
  };
}

// ---------------------------------------------------------------------------
// Realtime fan-out — notify every account that has visibility on the device.
// A device with `account_id = NULL` is shared via `account_boxes`; in that
// case the direct broadcast is skipped and we must fan out to all accounts
// that own the box, otherwise nobody (operator UI included) is told the
// state changed and the toggle stays stuck on the optimistic value.
// Uses the admin client because cross-account `account_boxes` rows are
// invisible under the caller's RLS.
// ---------------------------------------------------------------------------

async function fanOutDeviceStateChange(
  boxId: string,
  primaryAccountId: string | null,
): Promise<void> {
  const targets = new Set<string>();
  if (primaryAccountId) targets.add(primaryAccountId);

  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("account_boxes")
      .select("account_id")
      .eq("box_id", boxId);
    for (const row of data ?? []) {
      if (row.account_id) targets.add(row.account_id as string);
    }
  } catch {
    // Best-effort: fall through to whatever account_id we already have.
  }

  for (const accountId of targets) {
    broadcastAccountEvent(accountId, "devices", { action: "state_changed" });
  }
}

// ---------------------------------------------------------------------------
// Toggle screen wake/sleep
// ---------------------------------------------------------------------------

export async function toggleScreenWake(
  deviceId: string
): Promise<{ error: string | null; awake: boolean | null }> {
  try {
    const { dbId, tunnelHostname } = await resolveDeviceAccess(deviceId);

    const stateRes = await shell(tunnelHostname, dbId, "dumpsys power | grep mWakefulness");
    const isAwake = stateRes.message.includes("Awake");
    const keyevent = isAwake ? 223 : 224; // 223=sleep, 224=wake

    await shell(tunnelHostname, dbId, `input keyevent ${keyevent}`);

    return { error: null, awake: !isAwake };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Unknown error",
      awake: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Start container — waits for Android to finish booting before returning
// so the operator never sees a "running" state on a half-booted device.
// ---------------------------------------------------------------------------

export async function startContainer(
  deviceId: string
): Promise<{ error: string | null }> {
  try {
    const { deviceId: id, dbId, accountId, boxId, tunnelHostname } =
      await resolveDeviceAccess(deviceId);

    await ensureContainerReady(tunnelHostname, dbId);

    const supabase = await createClient();
    await supabase
      .from("devices")
      .update({ state: "running", last_seen: new Date().toISOString() })
      .eq("id", id);

    await fanOutDeviceStateChange(boxId, accountId);
    revalidatePath("/dashboard/operator");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Stop container — operator-initiated, unconditional
// ---------------------------------------------------------------------------

export async function stopContainer(
  deviceId: string
): Promise<{ error: string | null }> {
  try {
    const { deviceId: id, dbId, accountId, boxId, tunnelHostname } =
      await resolveDeviceAccess(deviceId);

    await stopContainerVmos(tunnelHostname, dbId);

    const supabase = await createClient();
    await supabase
      .from("devices")
      .update({ state: "stopped", last_seen: new Date().toISOString() })
      .eq("id", id);

    await fanOutDeviceStateChange(boxId, accountId);
    revalidatePath("/dashboard/operator");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Shell tap (used by the screenshot-mode click handler)
// ---------------------------------------------------------------------------

export async function shellTap(
  deviceId: string,
  x: number,
  y: number
): Promise<{ error: string | null }> {
  try {
    const { dbId, tunnelHostname } = await resolveDeviceAccess(deviceId);
    await shell(tunnelHostname, dbId, `input tap ${Math.round(x)} ${Math.round(y)}`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Enable audio capture — starts a dedicated scrcpy audio process.
// Uses shellSafe because the audio path is best-effort (UI tolerates absence).
// ---------------------------------------------------------------------------

// Mirrors the fallback logic in /data/local/scd.sh on the device:
// prefers /data/local/scd, falls back to /vendor/bin/scd
const SCRCPY_AUDIO_CMD = [
  "SCD=$([ -f /data/local/scd ] && echo /data/local/scd || echo /vendor/bin/scd);",
  "CLASSPATH=$SCD nohup app_process / com.genymobile.scrcpy.Server 3.3.3",
  "connection_mode=tcp",
  "video=false",
  "audio=true",
  "audio_port=9998",
  "control=false",
  "daemon=true",
  "send_dummy_byte=false",
  "log_level=error",
  "> /dev/null 2>&1 &",
].join(" ");

export async function enableDeviceAudio(
  deviceId: string
): Promise<{ error: string | null }> {
  try {
    const { dbId, tunnelHostname } = await resolveDeviceAccess(deviceId);

    const checkRes = await shellSafe(
      tunnelHostname,
      dbId,
      "netstat -tlnp 2>/dev/null | grep ':9998 ' | grep LISTEN || echo NO_AUDIO",
    );

    if (!checkRes || !checkRes.message.includes("NO_AUDIO")) {
      return { error: null };
    }

    await shell(tunnelHostname, dbId, SCRCPY_AUDIO_CMD);

    // Wait for the audio port to start accepting connections (up to ~2.5s)
    await shell(
      tunnelHostname,
      dbId,
      "for i in 1 2 3 4 5; do netstat -tlnp 2>/dev/null | grep ':9998 ' | grep -q LISTEN && break; sleep 0.5; done",
    );

    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

