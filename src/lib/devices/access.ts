import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canUserAccessDevice, requireSession } from "@/lib/auth/session";
import { broadcastAccountEvent } from "@/lib/supabase/realtime";

/**
 * Everything a server action needs to talk to a device's box and fan out
 * realtime updates. Shared by every operator-facing device action
 * (control, proxy, …) so the access check and the box lookup live in one
 * place instead of being copy-pasted per action file.
 */
export interface DeviceAccess {
  deviceId: string;
  dbId: string;
  accountId: string | null;
  boxId: string;
  tunnelHostname: string;
}

/**
 * Resolve a device, enforce that the caller can operate on it, and return
 * the box tunnel hostname. Mirrors the union access model of the
 * `client_read_assigned_devices` RLS policy via `canUserAccessDevice`
 * (direct `account_id` OR `account_boxes` share). Throws on any failure so
 * callers can wrap it in a single try/catch.
 */
export async function resolveDeviceAccess(deviceId: string): Promise<DeviceAccess> {
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

/**
 * Notify every account that has visibility on the device. A device with
 * `account_id = NULL` is shared via `account_boxes`; in that case we fan out
 * to all accounts that own the box, otherwise the operator UI never learns
 * the state changed. Uses the admin client because cross-account
 * `account_boxes` rows are invisible under the caller's RLS. Best-effort.
 */
export async function fanOutDeviceStateChange(
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

/**
 * PostgREST `.or(...)` filter selecting the devices an account can see: directly
 * assigned (`account_id`) OR inside a box shared via `account_boxes`. Mirrors the
 * `client_read_assigned_devices` RLS policy and is the single source of truth for
 * that scope (used by every account-scoped device query).
 */
export async function accountDeviceScopeFilter(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
): Promise<string> {
  const { data } = await supabase
    .from("account_boxes")
    .select("box_id")
    .eq("account_id", accountId);

  const boxIds = (data ?? []).map((b) => b.box_id);
  return boxIds.length > 0
    ? `account_id.eq.${accountId},box_id.in.(${boxIds.join(",")})`
    : `account_id.eq.${accountId}`;
}

// A device whose last_seen is fresher than this is treated as having an active
// stream (the server.mjs heartbeat refreshes it ~every 60s while streaming), so
// it is never auto-closed to free a slot. Older than this = stream closed.
const ACTIVE_STREAM_GRACE_MS = 90_000;

/**
 * Count of containers currently running on a box, across ALL accounts. Uses the
 * admin client because box capacity is shared between tenants and the caller's
 * RLS would hide other accounts' devices. This is the number the per-box
 * capacity limit is enforced against.
 */
export async function getBoxRunningCount(boxId: string): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("devices")
    .select("*", { count: "exact", head: true })
    .eq("box_id", boxId)
    .eq("state", "running");
  return count ?? 0;
}

export interface ReapCandidate {
  id: string;
  dbId: string;
  userName: string | null;
}

/**
 * Oldest running device on the box that the caller can reach (under their RLS
 * scope), is idle (no active stream for `ACTIVE_STREAM_GRACE_MS`), and has NO
 * pending/executing campaign job from ANY account (checked with the admin
 * client so the operator can never auto-close a device the automator still
 * needs). Returns null when nothing qualifies → the UI shows the capacity popup.
 */
export async function findReapableOwnDevice(
  supabase: Awaited<ReturnType<typeof createClient>>,
  boxId: string,
): Promise<ReapCandidate | null> {
  const cutoff = new Date(Date.now() - ACTIVE_STREAM_GRACE_MS).toISOString();
  const { data: candidates } = await supabase
    .from("devices")
    .select("id, db_id, user_name")
    .eq("box_id", boxId)
    .eq("state", "running")
    .lt("last_seen", cutoff)
    .order("last_seen", { ascending: true });

  if (!candidates || candidates.length === 0) return null;

  const admin = createAdminClient();
  const { data: busy } = await admin
    .from("campaign_jobs")
    .select("device_id")
    .in("device_id", candidates.map((c) => c.id))
    .in("status", ["ready", "executing"]);
  const busyIds = new Set((busy ?? []).map((b) => b.device_id));

  const victim = candidates.find((c) => !busyIds.has(c.id));
  return victim
    ? { id: victim.id, dbId: victim.db_id, userName: victim.user_name }
    : null;
}
