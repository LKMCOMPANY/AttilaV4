import type { RequestSession } from "@/lib/auth/session";
import {
  startContainerProcess,
  shell,
  shellSafe,
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

// ---------------------------------------------------------------------------
// Heartbeat — keep a streamed device's last_seen fresh
// ---------------------------------------------------------------------------
//
// The device reaper (`/api/devices/reap`) stops any `running` device whose
// last_seen is older than the idle window. The web operator's WS heartbeat
// (server.mjs) refreshes it every 60s; a native client streams directly and
// must post its own heartbeat on the same cadence, or the reaper would yank a
// live session. Runs on the caller's RLS-scoped client
// (`client_update_assigned_devices`), so it can only touch reachable devices.
// ---------------------------------------------------------------------------

export async function heartbeatCore(
  ctx: RequestSession,
  deviceId: string,
): Promise<{ error: string | null }> {
  try {
    const { deviceId: id } = await resolveDeviceAccess(ctx, deviceId);
    await ctx.supabase
      .from("devices")
      .update({ last_seen: new Date().toISOString() })
      .eq("id", id);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Enable audio capture — starts a dedicated scrcpy audio process on the device
// ---------------------------------------------------------------------------
//
// Audio is opt-in: the primary scrcpy process streams video+control only, so a
// second scrcpy instance must be started (audio-only, TCP :9998) before the
// client opens the `/stream/{dbId}/audio` socket. Idempotent — if the port is
// already listening we skip the start. Best-effort by design (`shellSafe` for
// the probe): the UI tolerates missing audio.
// ---------------------------------------------------------------------------

// Mirrors the fallback logic in /data/local/scd.sh on the device:
// prefers /data/local/scd, falls back to /vendor/bin/scd.
const SCRCPY_AUDIO_CMD = [
  "SCD=$([ -f /data/local/scd ] && echo /data/local/scd || echo /vendor/bin/scd);",
  "CLASSPATH=$SCD nohup app_process / com.genymobile.scrcpy.Server 3.3.3",
  "connection_mode=tcp",
  "video=false",
  "audio=true",
  "audio_port=9998",
  "control=false",
  "daemon=true",
  "send_dummy_byte=false",
  "log_level=error",
  "> /dev/null 2>&1 &",
].join(" ");

export async function enableAudioCore(
  ctx: RequestSession,
  deviceId: string,
): Promise<{ error: string | null }> {
  try {
    const { dbId, tunnelHostname } = await resolveDeviceAccess(ctx, deviceId);

    const checkRes = await shellSafe(
      tunnelHostname,
      dbId,
      "netstat -tlnp 2>/dev/null | grep ':9998 ' | grep LISTEN || echo NO_AUDIO",
    );

    if (!checkRes || !checkRes.message.includes("NO_AUDIO")) {
      return { error: null };
    }

    await shell(tunnelHostname, dbId, SCRCPY_AUDIO_CMD);

    // Wait for the audio port to start accepting connections (up to ~2.5s).
    await shell(
      tunnelHostname,
      dbId,
      "for i in 1 2 3 4 5; do netstat -tlnp 2>/dev/null | grep ':9998 ' | grep -q LISTEN && break; sleep 0.5; done",
    );

    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}
