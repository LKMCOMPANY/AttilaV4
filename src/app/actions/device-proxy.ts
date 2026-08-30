"use server";

import { revalidatePath } from "next/cache";
import { requireActionSession } from "@/lib/auth/session";
import {
  verifyDeviceProxyCore,
  updateDeviceProxyCore,
  clearDeviceProxyCore,
  type UpdateProxyInput,
  type VerifyProxyResult,
  type UpdateProxyResult,
} from "@/lib/operator/device-proxy";

export type {
  DeviceProxyFields,
  AppliedProxy,
  ProxyReachability,
  VerifyProxyResult,
  UpdateProxyResult,
  UpdateProxyInput,
} from "@/lib/operator/device-proxy";

// ---------------------------------------------------------------------------
// Cookie-transport wrappers around the proxy cores
// (`src/lib/operator/device-proxy.ts`) — the native REST routes call the
// same cores under a bearer token. Only the transport concerns (session from
// cookies, `revalidatePath`) live here.
// ---------------------------------------------------------------------------

export async function verifyDeviceProxy(deviceId: string): Promise<VerifyProxyResult> {
  try {
    const ctx = await requireActionSession();
    const result = await verifyDeviceProxyCore(ctx, deviceId);
    if (!result.error) revalidatePath("/dashboard/operator");
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error", applied: null, reachable: null };
  }
}

export async function updateDeviceProxy(
  input: UpdateProxyInput,
): Promise<UpdateProxyResult> {
  try {
    const ctx = await requireActionSession();
    const result = await updateDeviceProxyCore(ctx, input);
    if (!result.error) revalidatePath("/dashboard/operator");
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error", proxy: null };
  }
}

export async function clearDeviceProxy(deviceId: string): Promise<UpdateProxyResult> {
  try {
    const ctx = await requireActionSession();
    const result = await clearDeviceProxyCore(ctx, deviceId);
    if (!result.error) revalidatePath("/dashboard/operator");
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error", proxy: null };
  }
}
