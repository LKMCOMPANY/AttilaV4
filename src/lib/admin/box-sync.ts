import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RequestSession } from "@/lib/auth/session";
import {
  fetchHealthz,
  fetchContainerList,
  fetchContainerDetail,
  fetchTimezoneLocale,
  fetchProxyConfig,
  aospFromDetail,
} from "@/lib/box-api";

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
    .select("tunnel_hostname")
    .eq("id", boxId)
    .single();

  if (!box) return { error: "Box not found" };

  try {
    const health = await fetchHealthz(box.tunnel_hostname);

    await ctx.supabase
      .from("boxes")
      .update({
        status: "online",
        uptime_seconds: health.uptime,
        container_count: health.containers,
        last_heartbeat: new Date().toISOString(),
      })
      .eq("id", boxId);

    await syncBoxDevices(ctx.supabase, boxId, box.tunnel_hostname);
  } catch {
    // Box unreachable: mark offline AND reconcile its devices — nothing runs on
    // a down box, so any lingering `running` rows are stale (capacity/UI truth).
    await ctx.supabase
      .from("boxes")
      .update({ status: "offline" })
      .eq("id", boxId);
    await ctx.supabase
      .from("devices")
      .update({ state: "stopped", last_seen: new Date().toISOString() })
      .eq("box_id", boxId)
      .eq("state", "running");

    return { error: "Box is offline or unreachable." };
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

  // Update box lan_ip
  if (containerData.host_ip) {
    await supabase
      .from("boxes")
      .update({ lan_ip: containerData.host_ip })
      .eq("id", boxId);
  }

  // Collect all db_ids from the box API to detect removed devices
  const liveDbIds = new Set(containerData.list.map((c) => c.db_id));

  // Mark devices no longer on the box as 'removed'
  const { data: existingDevices } = await supabase
    .from("devices")
    .select("id, db_id, state")
    .eq("box_id", boxId);

  if (existingDevices) {
    const removedIds = existingDevices
      .filter((d) => !liveDbIds.has(d.db_id) && d.state !== "removed")
      .map((d) => d.id);

    if (removedIds.length > 0) {
      await supabase
        .from("devices")
        .update({ state: "removed", last_seen: new Date().toISOString() })
        .in("id", removedIds);
    }

    // Restore devices that reappear after being removed
    const restoredIds = existingDevices
      .filter((d) => liveDbIds.has(d.db_id) && d.state === "removed")
      .map((d) => d.id);

    if (restoredIds.length > 0) {
      await supabase
        .from("devices")
        .update({ state: "stopped" })
        .in("id", restoredIds);
    }
  }

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
