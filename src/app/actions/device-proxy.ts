"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDeviceAccess } from "@/lib/devices/access";
import {
  setProxyConfig,
  clearProxyConfig,
  fetchProxyConfig,
  fetchProxyDelayTest,
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

/**
 * Real reachability of the applied proxy, from the on-box `/proxy-test` probe
 * (mihomo delay through the upstream). `reachable === null` when the probe
 * could not run (e.g. device stopped); otherwise `ok` is the routing verdict.
 */
export interface ProxyReachability {
  ok: boolean;
  delayMs: number | null;
  reason: string | null;
}

export interface VerifyProxyResult {
  error: string | null;
  applied: AppliedProxy | null;
  reachable: ProxyReachability | null;
}

/** Map the box's machine error codes to a short operator-facing reason. */
function proxyTestReason(code: string | null): string | null {
  switch (code) {
    case null:
      return null;
    case "proxy_not_provisioned":
      return "No proxy engine on this device";
    case "mihomo_config_incomplete":
      return "Proxy config incomplete on device";
    case "engine_unreachable":
      return "Device/proxy engine not running";
    case "timeout":
      return "Timed out reaching the proxy";
    case "unreachable":
      return "Upstream proxy did not respond";
    case "transport":
      return "Could not reach the box";
    default:
      return code;
  }
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

    // Read the applied config and run the REAL routing test concurrently.
    const [live, delay] = await Promise.all([
      fetchProxyConfig(tunnelHostname, dbId),
      fetchProxyDelayTest(tunnelHostname, dbId),
    ]);

    if (!live) {
      return {
        error: "Could not read the proxy from the device — start it and retry.",
        applied: null,
        reachable: null,
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
    const { error: dbError } = await supabase
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
    if (dbError) {
      return { error: `Read the device but could not save: ${dbError.message}`, applied, reachable: null };
    }

    revalidatePath("/dashboard/operator");
    return {
      error: null,
      applied,
      reachable: { ok: delay.ok, delayMs: delay.delayMs, reason: proxyTestReason(delay.error) },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error", applied: null, reachable: null };
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

    // The real password is never sent to the browser (redacted on read), so an
    // empty password on an existing auth-proxy means "keep current". Look it up
    // server-side (admin client — the caller is already authorized) so editing
    // e.g. only the host never silently wipes the stored credentials.
    let effectivePassword = password;
    if (!effectivePassword && account) {
      const { data: current } = await createAdminClient()
        .from("devices")
        .select("proxy_password, proxy_account")
        .eq("id", id)
        .single();
      if (current?.proxy_account === account && current.proxy_password) {
        effectivePassword = current.proxy_password as string;
      }
    }

    await setProxyConfig(tunnelHostname, dbId, {
      proxyType,
      ip: host,
      port,
      account,
      password: effectivePassword,
    });

    const proxy: DeviceProxyFields = {
      proxy_enabled: true,
      proxy_type: proxyType,
      proxy_host: host,
      proxy_port: port,
      proxy_account: account || null,
      proxy_password: effectivePassword || null,
    };

    const supabase = await createClient();
    const { error, count } = await supabase
      .from("devices")
      .update(proxy, { count: "exact" })
      .eq("id", id);
    // VMOS already has the new proxy; if the DB write is blocked (RLS) or errors,
    // surface it instead of silently returning stale success (the historical
    // "proxy editing doesn't stick" bug). count===0 means RLS matched no row.
    if (error) return { error: `Applied on device but not saved: ${error.message}`, proxy: null };
    if (count === 0) {
      return {
        error: "Applied on device but you don't have permission to save it. Contact an admin.",
        proxy: null,
      };
    }

    revalidatePath("/dashboard/operator");
    return { error: null, proxy };
  } catch (err) {
    if (err instanceof ProxyTargetNotRunningError) {
      return { error: "Start the device before updating its proxy.", proxy: null };
    }
    return { error: err instanceof Error ? err.message : "Unknown error", proxy: null };
  }
}

// ---------------------------------------------------------------------------
// Clear — disable the proxy on the device (VMOS `proxy_stop`) + persist
// ---------------------------------------------------------------------------

export async function clearDeviceProxy(deviceId: string): Promise<UpdateProxyResult> {
  const parsed = z.string().uuid().safeParse(deviceId);
  if (!parsed.success) return { error: "Invalid device ID", proxy: null };

  try {
    const { deviceId: id, dbId, tunnelHostname } = await resolveDeviceAccess(parsed.data);

    await clearProxyConfig(tunnelHostname, dbId);

    const proxy: DeviceProxyFields = {
      proxy_enabled: false,
      proxy_type: null,
      proxy_host: null,
      proxy_port: null,
      proxy_account: null,
      proxy_password: null,
    };

    const supabase = await createClient();
    const { error, count } = await supabase
      .from("devices")
      .update(proxy, { count: "exact" })
      .eq("id", id);
    if (error) return { error: `Cleared on device but not saved: ${error.message}`, proxy: null };
    if (count === 0) {
      return { error: "Cleared on device but you don't have permission to save it. Contact an admin.", proxy: null };
    }

    revalidatePath("/dashboard/operator");
    return { error: null, proxy };
  } catch (err) {
    if (err instanceof ProxyTargetNotRunningError) {
      return { error: "Start the device before clearing its proxy.", proxy: null };
    }
    return { error: err instanceof Error ? err.message : "Unknown error", proxy: null };
  }
}
