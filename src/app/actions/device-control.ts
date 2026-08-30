"use server";

import { revalidatePath } from "next/cache";
import { requireActionSession } from "@/lib/auth/session";
import { shell, shellSafe } from "@/lib/box-api";
import { resolveDeviceAccess } from "@/lib/devices/access";
import {
  toggleScreenWakeCore,
  startContainerCore,
  stopContainerCore,
} from "@/lib/operator/device-control";

export type { StartContainerResult } from "@/lib/operator/device-control";

// ---------------------------------------------------------------------------
// Cookie-transport wrappers around the device-control cores
// (`src/lib/operator/device-control.ts`) — the native REST routes call the
// same cores under a bearer token. Only the transport concerns (session from
// cookies, `revalidatePath`) live here.
// ---------------------------------------------------------------------------

export async function toggleScreenWake(
  deviceId: string
): Promise<{ error: string | null; awake: boolean | null }> {
  try {
    const ctx = await requireActionSession();
    return await toggleScreenWakeCore(ctx, deviceId);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Unknown error",
      awake: null,
    };
  }
}

export async function startContainer(deviceId: string) {
  try {
    const ctx = await requireActionSession();
    const result = await startContainerCore(ctx, deviceId);
    if (!result.error && !result.atCapacity) revalidatePath("/dashboard/operator");
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function stopContainer(
  deviceId: string
): Promise<{ error: string | null }> {
  try {
    const ctx = await requireActionSession();
    const result = await stopContainerCore(ctx, deviceId);
    if (!result.error) revalidatePath("/dashboard/operator");
    return result;
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
    const ctx = await requireActionSession();
    const { dbId, tunnelHostname } = await resolveDeviceAccess(ctx, deviceId);
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
    const ctx = await requireActionSession();
    const { dbId, tunnelHostname } = await resolveDeviceAccess(ctx, deviceId);

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
