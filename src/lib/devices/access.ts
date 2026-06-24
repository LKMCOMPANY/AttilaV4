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
