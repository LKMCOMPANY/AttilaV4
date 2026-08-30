import type { RequestSession } from "@/lib/auth/session";
import {
  startContainerProcess,
  shell,
  stopContainer as stopContainerVmos,
} from "@/lib/box-api";
import {
  resolveDeviceAccess,
  fanOutDeviceStateChange,
  getBoxRunningCount,
  findReapableOwnDevice,
} from "@/lib/devices/access";

/**
 * Device power/lifecycle cores — the single implementation behind the
 * Server Actions (`src/app/actions/device-control.ts`, cookie transport)
 * and the native REST routes (`/api/devices/[id]/…`, bearer transport).
 * Business failures come back as `{ error }` payloads; only transport/auth
 * failures throw (mapped to 401/403 by `nativeRoute`).
 */

// ---------------------------------------------------------------------------
// Toggle screen wake/sleep
// ---------------------------------------------------------------------------

export async function toggleScreenWakeCore(
  ctx: RequestSession,
  deviceId: string,
): Promise<{ error: string | null; awake: boolean | null }> {
  try {
    const { dbId, tunnelHostname } = await resolveDeviceAccess(ctx, deviceId);

    const stateRes = await shell(tunnelHostname, dbId, "dumpsys power | grep mWakefulness");
    const isAwake = stateRes.message.includes("Awake");
    const keyevent = isAwake ? 223 : 224; // 223=sleep, 224=wake

    await shell(tunnelHostname, dbId, `input keyevent ${keyevent}`);

    return { error: null, awake: !isAwake };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Unknown error",
      awake: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Start container — issues the run and returns immediately (~1–2s) without
// blocking on the full Android boot. The operator UI gates the live stream on
// the `/stream-ready` probe, so the Start button stays responsive.
//
// Capacity (hybrid): starting a NEW container is gated on the box's
// `max_concurrent_containers` (shared with the automator). When the box is
// full we first try to auto-close one idle device the caller can reach; if
// none qualifies we return `atCapacity` so the UI can ask the operator to free
// a slot. Starting an already-running device is never gated (no new container).
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CONTAINERS = 3;

export interface StartContainerResult {
  error: string | null;
  atCapacity?: boolean;
  max?: number;
  running?: { id: string; userName: string | null }[];
  autoClosed?: { userName: string | null };
}

export async function startContainerCore(
  ctx: RequestSession,
  deviceId: string,
): Promise<StartContainerResult> {
  try {
    const { deviceId: id, dbId, accountId, boxId, tunnelHostname } =
      await resolveDeviceAccess(ctx, deviceId);

    const { data: row } = await ctx.supabase
      .from("devices")
      .select("state, boxes(max_concurrent_containers)")
      .eq("id", id)
      .single();

    const alreadyRunning = row?.state === "running";
    const max =
      (row?.boxes as unknown as { max_concurrent_containers: number } | null)
        ?.max_concurrent_containers ?? DEFAULT_MAX_CONTAINERS;

    let autoClosed: { userName: string | null } | undefined;

    if (!alreadyRunning && (await getBoxRunningCount(boxId)) >= max) {
      const victim = await findReapableOwnDevice(ctx.supabase, boxId);
      if (victim) {
        await stopContainerVmos(tunnelHostname, victim.dbId);
        await ctx.supabase
          .from("devices")
          .update({ state: "stopped", last_seen: new Date().toISOString() })
          .eq("id", victim.id);
        autoClosed = { userName: victim.userName };
      } else {
        const { data: running } = await ctx.supabase
          .from("devices")
          .select("id, user_name")
          .eq("box_id", boxId)
          .eq("state", "running");
        return {
          error: null,
          atCapacity: true,
          max,
          running: (running ?? []).map((d) => ({ id: d.id, userName: d.user_name })),
        };
      }
    }

    await startContainerProcess(tunnelHostname, dbId);
    await ctx.supabase
      .from("devices")
      .update({ state: "running", last_seen: new Date().toISOString() })
      .eq("id", id);

    await fanOutDeviceStateChange(boxId, accountId);
    return { error: null, autoClosed };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Stop container — operator-initiated, unconditional
// ---------------------------------------------------------------------------

export async function stopContainerCore(
  ctx: RequestSession,
  deviceId: string,
): Promise<{ error: string | null }> {
  try {
    const { deviceId: id, dbId, accountId, boxId, tunnelHostname } =
      await resolveDeviceAccess(ctx, deviceId);

    await stopContainerVmos(tunnelHostname, dbId);

    await ctx.supabase
      .from("devices")
      .update({ state: "stopped", last_seen: new Date().toISOString() })
      .eq("id", id);

    await fanOutDeviceStateChange(boxId, accountId);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}
