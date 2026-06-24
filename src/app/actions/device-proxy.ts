"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveDeviceAccess } from "@/lib/devices/access";
import {
  checkProxyEgress,
  setProxyConfig,
  ContainerNotReadyError,
  ProxyTargetNotRunningError,
  type ProxyEgressResult,
} from "@/lib/box-api";

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** Proxy columns surfaced to the operator UI (password is masked client-side). */
export interface DeviceProxyFields {
  proxy_enabled: boolean;
  proxy_type: string | null;
  proxy_host: string | null;
  proxy_port: number | null;
  proxy_account: string | null;
  proxy_password: string | null;
}

export interface TestProxyResult {
  error: string | null;
  deviceStopped: boolean;
  egress: ProxyEgressResult | null;
}

export interface UpdateProxyResult {
  error: string | null;
  proxy: DeviceProxyFields | null;
  /** proxy_set persists at the VMOS layer; Clash only re-reads on restart. */
  requiresRestart: boolean;
}

const updateProxySchema = z.object({
  deviceId: z.string().uuid(),
  proxyType: z.enum(["socks5", "http"]),
  host: z.string().trim().min(1, "Host is required").max(255),
  port: z.coerce.number().int().min(1).max(65535),
  account: z.string().trim().max(255).default(""),
  password: z.string().max(255).default(""),
});

export type UpdateProxyInput = z.input<typeof updateProxySchema>;

// ---------------------------------------------------------------------------
// Test — real egress check through the device (true exit IP + geo)
// ---------------------------------------------------------------------------

export async function testDeviceProxy(deviceId: string): Promise<TestProxyResult> {
  try {
    const { dbId, tunnelHostname } = await resolveDeviceAccess(deviceId);
    const egress = await checkProxyEgress(tunnelHostname, dbId);
    return { error: null, deviceStopped: false, egress };
  } catch (err) {
    if (err instanceof ContainerNotReadyError) {
      return {
        error: "Device is stopped — start it before testing the proxy.",
        deviceStopped: true,
        egress: null,
      };
    }
    return {
      error: err instanceof Error ? err.message : "Unknown error",
      deviceStopped: false,
      egress: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Update — write the proxy to VMOS + persist to the DB
// ---------------------------------------------------------------------------

export async function updateDeviceProxy(
  input: UpdateProxyInput,
): Promise<UpdateProxyResult> {
  const parsed = updateProxySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, proxy: null, requiresRestart: false };
  }
  const { deviceId, proxyType, host, port, account, password } = parsed.data;

  try {
    const { deviceId: id, dbId, tunnelHostname } = await resolveDeviceAccess(deviceId);

    await setProxyConfig(tunnelHostname, dbId, {
      proxyType,
      ip: host,
      port,
      account,
      password,
    });

    const proxy: DeviceProxyFields = {
      proxy_enabled: true,
      proxy_type: proxyType,
      proxy_host: host,
      proxy_port: port,
      proxy_account: account || null,
      proxy_password: password || null,
    };

    const supabase = await createClient();
    const { error } = await supabase.from("devices").update(proxy).eq("id", id);
    if (error) return { error: error.message, proxy: null, requiresRestart: false };

    revalidatePath("/dashboard/operator");
    return { error: null, proxy, requiresRestart: true };
  } catch (err) {
    if (err instanceof ProxyTargetNotRunningError) {
      return {
        error: "Start the device before updating its proxy.",
        proxy: null,
        requiresRestart: false,
      };
    }
    return {
      error: err instanceof Error ? err.message : "Unknown error",
      proxy: null,
      requiresRestart: false,
    };
  }
}
