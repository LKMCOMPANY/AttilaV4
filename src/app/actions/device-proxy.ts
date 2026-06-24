"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveDeviceAccess } from "@/lib/devices/access";
import {
  setProxyConfig,
  fetchProxyConfig,
  ProxyTargetNotRunningError,
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

/** Proxy actually applied on the device, read live from the box (`proxy_get`). */
export interface AppliedProxy {
  enabled: boolean;
  type: string | null;
  host: string | null;
  port: number | null;
  account: string | null;
}

export interface VerifyProxyResult {
  error: string | null;
  applied: AppliedProxy | null;
}

export interface UpdateProxyResult {
  error: string | null;
  proxy: DeviceProxyFields | null;
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
// Verify — read the proxy actually applied on the device, and resync the DB
// ---------------------------------------------------------------------------
//
// `proxy_get` reflects the live per-container mihomo config managed by the box
// backend (`cbs_go`). We deliberately do NOT use its `healthy` flag as a
// connectivity signal — it was observed to report `true` on proxies that did
// not route at all. A true reachability test requires the host-side mihomo
// delay API, which is not exposed through the tunnel; that is tracked
// separately. This verifies what is *applied*, not whether it reaches the net.
// ---------------------------------------------------------------------------

export async function verifyDeviceProxy(deviceId: string): Promise<VerifyProxyResult> {
  try {
    const { deviceId: id, dbId, tunnelHostname } = await resolveDeviceAccess(deviceId);

    const live = await fetchProxyConfig(tunnelHostname, dbId);
    if (!live) {
      return {
        error: "Could not read the proxy from the device — start it and retry.",
        applied: null,
      };
    }

    const applied: AppliedProxy = {
      enabled: live.enabled,
      type: live.proxyType ?? null,
      host: live.ip ?? null,
      port: live.port ?? null,
      account: live.account ?? null,
    };

    // Keep the DB in sync with what the device actually reports.
    const supabase = await createClient();
    await supabase
      .from("devices")
      .update({
        proxy_enabled: applied.enabled,
        proxy_type: applied.type,
        proxy_host: applied.host,
        proxy_port: applied.port,
        proxy_account: applied.account,
        proxy_password: live.password ?? null,
      })
      .eq("id", id);

    revalidatePath("/dashboard/operator");
    return { error: null, applied };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error", applied: null };
  }
}

// ---------------------------------------------------------------------------
// Update — provision the proxy on the device (live) + persist to the DB
// ---------------------------------------------------------------------------
//
// `setProxyConfig` (VMOS `proxy_set`) makes `cbs_go` rewrite the host-side
// mihomo config and hot-reload it: the change is applied to the device
// immediately, no restart. It requires the container to be running.
// ---------------------------------------------------------------------------

export async function updateDeviceProxy(
  input: UpdateProxyInput,
): Promise<UpdateProxyResult> {
  const parsed = updateProxySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, proxy: null };
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
    if (error) return { error: error.message, proxy: null };

    revalidatePath("/dashboard/operator");
    return { error: null, proxy };
  } catch (err) {
    if (err instanceof ProxyTargetNotRunningError) {
      return { error: "Start the device before updating its proxy.", proxy: null };
    }
    return { error: err instanceof Error ? err.message : "Unknown error", proxy: null };
  }
}
