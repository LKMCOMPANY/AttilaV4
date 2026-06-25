"use server";

import { createClient } from "@/lib/supabase/server";
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
import { revalidatePath } from "next/cache";

// ---------------------------------------------------------------------------
// Toggle screen wake/sleep
// ---------------------------------------------------------------------------

export async function toggleScreenWake(
  deviceId: string
): Promise<{ error: string | null; awake: boolean | null }> {
  try {
    const { dbId, tunnelHostname } = await resolveDeviceAccess(deviceId);

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

export async function startContainer(
  deviceId: string
): Promise<StartContainerResult> {
  try {
    const { deviceId: id, dbId, accountId, boxId, tunnelHostname } =
      await resolveDeviceAccess(deviceId);

    const supabase = await createClient();
    const { data: row } = await supabase
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
      const victim = await findReapableOwnDevice(supabase, boxId);
      if (victim) {
        await stopContainerVmos(tunnelHostname, victim.dbId);
        await supabase
          .from("devices")
          .update({ state: "stopped", last_seen: new Date().toISOString() })
          .eq("id", victim.id);
        autoClosed = { userName: victim.userName };
      } else {
        const { data: running } = await supabase
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
    await supabase
      .from("devices")
      .update({ state: "running", last_seen: new Date().toISOString() })
      .eq("id", id);

    await fanOutDeviceStateChange(boxId, accountId);
    revalidatePath("/dashboard/operator");
    return { error: null, autoClosed };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Stop container — operator-initiated, unconditional
// ---------------------------------------------------------------------------

export async function stopContainer(
  deviceId: string
): Promise<{ error: string | null }> {
  try {
    const { deviceId: id, dbId, accountId, boxId, tunnelHostname } =
      await resolveDeviceAccess(deviceId);

    await stopContainerVmos(tunnelHostname, dbId);

    const supabase = await createClient();
    await supabase
      .from("devices")
      .update({ state: "stopped", last_seen: new Date().toISOString() })
      .eq("id", id);

    await fanOutDeviceStateChange(boxId, accountId);
    revalidatePath("/dashboard/operator");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Shell tap (used by the screenshot-mode click handler)
// ---------------------------------------------------------------------------

export async function shellTap(
  deviceId: string,
  x: number,
  y: number
): Promise<{ error: string | null }> {
  try {
    const { dbId, tunnelHostname } = await resolveDeviceAccess(deviceId);
    await shell(tunnelHostname, dbId, `input tap ${Math.round(x)} ${Math.round(y)}`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Enable audio capture — starts a dedicated scrcpy audio process.
// Uses shellSafe because the audio path is best-effort (UI tolerates absence).
// ---------------------------------------------------------------------------

// Mirrors the fallback logic in /data/local/scd.sh on the device:
// prefers /data/local/scd, falls back to /vendor/bin/scd
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

export async function enableDeviceAudio(
  deviceId: string
): Promise<{ error: string | null }> {
  try {
    const { dbId, tunnelHostname } = await resolveDeviceAccess(deviceId);

    const checkRes = await shellSafe(
      tunnelHostname,
      dbId,
      "netstat -tlnp 2>/dev/null | grep ':9998 ' | grep LISTEN || echo NO_AUDIO",
    );

    if (!checkRes || !checkRes.message.includes("NO_AUDIO")) {
      return { error: null };
    }

    await shell(tunnelHostname, dbId, SCRCPY_AUDIO_CMD);

    // Wait for the audio port to start accepting connections (up to ~2.5s)
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

