"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  fetchHealthz,
  fetchContainerList,
  fetchContainerDetail,
  fetchTimezoneLocale,
  fetchProxyConfig,
} from "@/lib/box-api";
import type { Account, Box, BoxWithRelations } from "@/types";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createBoxSchema = z.object({
  tunnel_hostname: z
    .string()
    .min(1, "Hostname is required")
    .regex(/^[a-z0-9.-]+$/, "Invalid hostname format"),
  name: z.string().max(100).optional(),
});

const updateBoxSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const boxAccountSchema = z.object({
  boxId: z.string().uuid(),
  accountId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

interface AccountBoxRow {
  account_id: string;
  accounts: Account;
}

function mapBoxRow(
  box: Record<string, unknown> & { account_boxes?: AccountBoxRow[] },
  deviceCount: number
): BoxWithRelations {
  const accountBoxes = box.account_boxes ?? [];
  const { account_boxes: _, ...rest } = box;
  return {
    ...rest,
    accounts: accountBoxes.map((ab) => ab.accounts),
    device_count: deviceCount,
  } as BoxWithRelations;
}

export async function getBoxes(): Promise<BoxWithRelations[]> {
  await requireAdmin();
  const supabase = await createClient();

  const [boxesResult, countsResult] = await Promise.all([
    supabase
      .from("boxes")
      .select("*, account_boxes(account_id, accounts(*))")
      .order("created_at", { ascending: false }),
    supabase.rpc("get_device_counts_by_box"),
  ]);

  if (boxesResult.error) throw new Error(boxesResult.error.message);

  const countMap = new Map<string, number>();
  if (!countsResult.error && countsResult.data) {
    (countsResult.data as { box_id: string; count: number }[]).forEach((row) =>
      countMap.set(row.box_id, row.count)
    );
  }

  return (boxesResult.data ?? []).map((box) =>
    mapBoxRow(box as Record<string, unknown> & { account_boxes?: AccountBoxRow[] }, countMap.get((box as { id: string }).id) ?? 0)
  );
}

export async function getBox(id: string): Promise<BoxWithRelations | null> {
  await requireAdmin();
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return null;

  const supabase = await createClient();

  const [boxResult, countResult] = await Promise.all([
    supabase
      .from("boxes")
      .select("*, account_boxes(account_id, accounts(*))")
      .eq("id", id)
      .single(),
    supabase
      .from("devices")
      .select("*", { count: "exact", head: true })
      .eq("box_id", id),
  ]);

  if (boxResult.error || !boxResult.data) return null;

  return mapBoxRow(
    boxResult.data as Record<string, unknown> & { account_boxes?: AccountBoxRow[] },
    countResult.count ?? 0
  );
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createBox(
  input: z.infer<typeof createBoxSchema>
): Promise<{ data: Box | null; error: string | null }> {
  await requireAdmin();

  const parsed = createBoxSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.issues[0].message };
  }

  // Verify box is reachable
  let healthData;
  try {
    healthData = await fetchHealthz(parsed.data.tunnel_hostname);
  } catch {
    return {
      data: null,
      error: `Box unreachable at ${parsed.data.tunnel_hostname}. Verify the tunnel is running.`,
    };
  }

  const supabase = await createClient();

  // Insert box
  const { data: box, error } = await supabase
    .from("boxes")
    .insert({
      tunnel_hostname: parsed.data.tunnel_hostname,
      name: parsed.data.name || parsed.data.tunnel_hostname,
      status: "online",
      uptime_seconds: healthData.uptime,
      container_count: healthData.containers,
      last_heartbeat: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return { data: null, error: "A box with this hostname already exists." };
    }
    return { data: null, error: error.message };
  }

  // Auto-discover devices
  try {
    await syncBoxDevices(box.id, parsed.data.tunnel_hostname);
  } catch {
    // Box is registered even if initial sync fails
  }

  revalidatePath("/admin/infrastructure");
  return { data: box as Box, error: null };
}

export async function updateBox(
  input: z.infer<typeof updateBoxSchema>
): Promise<{ error: string | null }> {
  await requireAdmin();

  const parsed = updateBoxSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { id, ...fields } = parsed.data;
  const updates: Record<string, unknown> = {};
  if (fields.name !== undefined) updates.name = fields.name;
  if (fields.metadata !== undefined) updates.metadata = fields.metadata;

  if (Object.keys(updates).length === 0) return { error: null };

  const supabase = await createClient();
  const { error } = await supabase.from("boxes").update(updates).eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/admin/infrastructure");
  return { error: null };
}

export async function deleteBox(
  id: string
): Promise<{ error: string | null }> {
  await requireAdmin();
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { error: "Invalid box ID" };

  const supabase = await createClient();

  const { error } = await supabase.from("boxes").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/infrastructure");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Box ↔ Account assignment
// ---------------------------------------------------------------------------

export async function assignBoxToAccount(
  input: z.infer<typeof boxAccountSchema>
): Promise<{ error: string | null }> {
  await requireAdmin();

  const parsed = boxAccountSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.from("account_boxes").upsert(
    { account_id: parsed.data.accountId, box_id: parsed.data.boxId },
    { onConflict: "account_id,box_id" }
  );

  if (error) return { error: error.message };

  revalidatePath("/admin/infrastructure");
  return { error: null };
}

export async function unassignBoxFromAccount(
  input: z.infer<typeof boxAccountSchema>
): Promise<{ error: string | null }> {
  await requireAdmin();

  const parsed = boxAccountSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("account_boxes")
    .delete()
    .eq("account_id", parsed.data.accountId)
    .eq("box_id", parsed.data.boxId);

  if (error) return { error: error.message };

  revalidatePath("/admin/infrastructure");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Sync — Refresh box status + discover/update devices
// ---------------------------------------------------------------------------

export async function syncBox(
  boxId: string
): Promise<{ error: string | null }> {
  await requireAdmin();
  const parsed = z.string().uuid().safeParse(boxId);
  if (!parsed.success) return { error: "Invalid box ID" };

  const supabase = await createClient();

  const { data: box } = await supabase
    .from("boxes")
    .select("tunnel_hostname")
    .eq("id", boxId)
    .single();

  if (!box) return { error: "Box not found" };

  try {
    const health = await fetchHealthz(box.tunnel_hostname);

    await supabase
      .from("boxes")
      .update({
        status: "online",
        uptime_seconds: health.uptime,
        container_count: health.containers,
        last_heartbeat: new Date().toISOString(),
      })
      .eq("id", boxId);

    await syncBoxDevices(boxId, box.tunnel_hostname);
  } catch {
    await supabase
      .from("boxes")
      .update({ status: "offline" })
      .eq("id", boxId);

    revalidatePath("/admin/infrastructure");
    return { error: "Box is offline or unreachable." };
  }

  revalidatePath("/admin/infrastructure");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Internal: sync devices from a box
// ---------------------------------------------------------------------------

async function syncBoxDevices(boxId: string, tunnelHostname: string) {
  const supabase = await createClient();
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
      if (detail.aosp_version) updates.aosp_version = detail.aosp_version;
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
