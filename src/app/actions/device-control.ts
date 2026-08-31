"use server";

import { revalidatePath } from "next/cache";
import { requireActionSession } from "@/lib/auth/session";
import { shell } from "@/lib/box-api";
import { resolveDeviceAccess } from "@/lib/devices/access";
import {
  toggleScreenWakeCore,
  startContainerCore,
  stopContainerCore,
  enableAudioCore,
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
// Enable audio capture — cookie-transport wrapper around `enableAudioCore`
// (the native route calls the same core under a bearer token).
// ---------------------------------------------------------------------------

export async function enableDeviceAudio(
  deviceId: string
): Promise<{ error: string | null }> {
  try {
    const ctx = await requireActionSession();
    return await enableAudioCore(ctx, deviceId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}
