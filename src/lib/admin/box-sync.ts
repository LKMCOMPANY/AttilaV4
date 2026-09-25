import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RequestSession } from "@/lib/auth/session";
import {
  fetchContainerList,
  fetchContainerDetail,
  fetchTimezoneLocale,
  fetchProxyConfig,
  aospFromDetail,
} from "@/lib/box-api";
import { reconcileDeviceRows } from "@/lib/boxes/device-inventory";
import { BOX_PRESENCE_COLUMNS, observeBox, type BoxPresenceRow } from "@/lib/boxes/presence";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Box / device sync cores (admin-only) — the single implementation behind
 * the Server Actions (`src/app/actions/boxes.ts`, `devices.ts`) and the
 * native REST routes (`/api/admin/boxes/[id]/sync`,
 * `/api/admin/devices/[id]/sync`). Each core re-asserts the admin role so a
 * mis-wired route can never leak infrastructure control.
 */

function requireAdminRole(ctx: RequestSession): string | null {
  return ctx.session.profile.role === "admin"
    ? null
    : "Forbidden: admin access required";
}

// ---------------------------------------------------------------------------
// Sync — refresh box status + discover/update devices
// ---------------------------------------------------------------------------

export async function syncBoxCore(
  ctx: RequestSession,
  boxId: string,
): Promise<{ error: string | null }> {
  const forbidden = requireAdminRole(ctx);
  if (forbidden) return { error: forbidden };

  const parsed = z.string().uuid().safeParse(boxId);
  if (!parsed.success) return { error: "Invalid box ID" };

  const { data: box } = await ctx.supabase
    .from("boxes")
    .select(BOX_PRESENCE_COLUMNS)
    .eq("id", boxId)
    .single();

  if (!box) return { error: "Box not found" };
  const row = box as unknown as BoxPresenceRow;

  // Presence goes through the one writer (status, observed lan_ip, uptime,
  // host sample, firmware facts — read now, the admin asked). A Sync is the
  // moment an operator wants the truth, so the firmware facts are re-read.
  const admin = ctx.supabase as unknown as ReturnType<typeof createAdminClient>;
  const { observation } = await observeBox(admin, row, { withFirmware: true });
  if (!observation.health) {
    // Nothing runs on a down box: the reconcile worker cannot see it either, so
    // any lingering `running` rows are stale (capacity/UI truth).
    await ctx.supabase
      .from("devices")
      .update({ state: "stopped", last_seen: new Date().toISOString() })
      .eq("box_id", boxId)
      .eq("state", "running");
    return { error: "Box is offline or unreachable." };
  }

  try {
    await syncBoxDevices(ctx.supabase, boxId, row.tunnel_hostname);
  } catch {
    return { error: "Box answered but its device inventory could not be read." };
  }

  return { error: null };
}

// ---------------------------------------------------------------------------
// Sync single device detail from the box API
// ---------------------------------------------------------------------------

export async function syncDeviceDetailCore(
  ctx: RequestSession,
  deviceId: string,
): Promise<{ error: string | null }> {
  const forbidden = requireAdminRole(ctx);
  if (forbidden) return { error: forbidden };

  const parsed = z.string().uuid().safeParse(deviceId);
  if (!parsed.success) return { error: "Invalid device ID" };

  const { data: device } = await ctx.supabase
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
      const aosp = aospFromDetail(detail);
      if (aosp) updates.aosp_version = aosp;
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

  const { error } = await ctx.supabase
    .from("devices")
    .update(updates)
    .eq("id", deviceId);

  if (error) return { error: error.message };
  return { error: null };
}

// ---------------------------------------------------------------------------
// Device discovery — upsert the box's containers into `devices`
// ---------------------------------------------------------------------------

export async function syncBoxDevices(
  supabase: SupabaseClient,
  boxId: string,
  tunnelHostname: string,
): Promise<void> {
  const containerData = await fetchContainerList(tunnelHostname);

  // running / stopped / removed / restored — the same rule as the reconcile
  // worker (lan_ip is written by the presence writer, not here).
  await reconcileDeviceRows(supabase as unknown as ReturnType<typeof createAdminClient>, boxId, containerData.list, {
    broadcast: false,
  });

  for (const container of containerData.list) {
    // Upsert basic device info
    const { data: device } = await supabase
      .from("devices")
      .upsert(
        {
          box_id: boxId,
          db_id: container.db_id,
          user_name: container.user_name,
          state: container.state,
          last_seen: new Date().toISOString(),
        },
        { onConflict: "db_id" }
      )
      .select("id")
      .single();

    if (!device) continue;

    const isRunning = container.state === "running";
    const updates: Record<string, unknown> = {};

    // Hardware detail is available for ALL devices (running returns code 200, stopped returns 201)
    const detailPromise = fetchContainerDetail(tunnelHostname, container.db_id).catch(() => null);

    // Timezone/locale and proxy only work on running devices
    const tzPromise = isRunning
      ? fetchTimezoneLocale(tunnelHostname, container.db_id).catch(() => null)
      : Promise.resolve(null);
    const proxyPromise = isRunning
      ? fetchProxyConfig(tunnelHostname, container.db_id).catch(() => null)
      : Promise.resolve(null);

    const [detail, tz, proxy] = await Promise.all([detailPromise, tzPromise, proxyPromise]);

    if (detail) {
      updates.image = detail.image;
      // Derive from the image when the reported value is missing/"initializing"
      // so we never persist junk (see aospFromDetail).
      const aosp = aospFromDetail(detail);
      if (aosp) updates.aosp_version = aosp;
      updates.resolution = `${detail.width}x${detail.height}`;
      updates.memory_mb = detail.memory;
      updates.dpi = parseInt(detail.dpi, 10) || null;
      updates.fps = parseInt(detail.fps, 10) || null;
      if (detail.ip) updates.docker_ip = detail.ip;
    }

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

    if (Object.keys(updates).length > 0) {
      await supabase
        .from("devices")
        .update(updates)
        .eq("id", device.id);
    }
  }
}
