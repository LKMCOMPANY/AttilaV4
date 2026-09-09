import { ensureContainerReady, stopContainerIfIdle, waitForControlApi } from "@/lib/box-api";
import { getCurrentIme, restoreIme } from "@/lib/automation/adb-helpers";
import { assessBoxSlot, withStartSlot, type BoxRow, type SlotDecision } from "@/lib/engine/box-slots";
import type { DeviceRef } from "@/lib/engine/device";
import type { createAdminClient } from "@/lib/supabase/admin";
import { broadcastAccountEvent } from "@/lib/supabase/realtime";
import type { MaintenanceTask, SocialCredentials, SocialPlatform } from "@/types";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface SessionAvatar {
  id: string;
  account_id: string;
  first_name: string;
  last_name: string;
  country_code: string;
  language_code: string;
  tiktok_credentials: SocialCredentials | null;
  twitter_credentials: SocialCredentials | null;
}

export interface SessionDevice {
  id: string;
  db_id: string;
  box_id: string;
  timezone: string | null;
  locale: string | null;
  country: string | null;
  proxy_enabled: boolean | null;
  proxy_host: string | null;
  agent_line: string | null;
}

/**
 * One maintenance session on one device: the container is up, the v2 agent
 * line is known, the IME is snapshotted and a `maintainer` usage session is
 * open. `close()` puts everything back and stops the container when nothing
 * else needs it.
 */
export interface DeviceSession {
  dev: DeviceRef;
  avatar: SessionAvatar;
  device: SessionDevice;
  box: BoxRow;
  platform: SocialPlatform | null;
  wasStarted: boolean;
  close(): Promise<void>;
}

export type SessionRefusal = { kind: "refused"; slot: SlotDecision } | { kind: "missing"; what: "avatar" | "device" | "box" };

/** Handle of a maintenance credential lookup: which platform's account the task is about. */
export function credentialsFor(avatar: SessionAvatar, platform: SocialPlatform | null): SocialCredentials | null {
  if (platform === "tiktok") return avatar.tiktok_credentials;
  if (platform === "twitter") return avatar.twitter_credentials;
  return null;
}

/**
 * Open the session for a task, or say why it cannot be opened right now. A
 * slot refusal is not an error: the task is put back in the queue a little
 * later by the caller. Starting a container goes through the box's start slot
 * (at most two cold boots in flight per box).
 */
export async function openDeviceSession(
  supabase: AdminClient,
  task: Pick<MaintenanceTask, "id" | "avatar_id" | "device_id" | "platform">,
): Promise<DeviceSession | SessionRefusal> {
  const { data: avatar } = await supabase
    .from("avatars")
    .select("id, account_id, first_name, last_name, country_code, language_code, tiktok_credentials, twitter_credentials")
    .eq("id", task.avatar_id)
    .maybeSingle();
  if (!avatar) return { kind: "missing", what: "avatar" };

  const deviceId = task.device_id;
  const { data: device } = deviceId
    ? await supabase
        .from("devices")
        .select("id, db_id, box_id, timezone, locale, country, proxy_enabled, proxy_host, agent_line")
        .eq("id", deviceId)
        .maybeSingle()
    : { data: null };
  if (!device) return { kind: "missing", what: "device" };

  const { data: box } = await supabase
    .from("boxes")
    .select("id, tunnel_hostname, max_concurrent_containers, operator_reserve")
    .eq("id", device.box_id)
    .maybeSingle();
  if (!box) return { kind: "missing", what: "box" };

  const slot = await assessBoxSlot(supabase, box, device.db_id, "maintenance");
  if (!slot.granted) return { kind: "refused", slot };

  const host = box.tunnel_hostname;
  const { wasStarted } = slot.reason === "already_running"
    ? await ensureContainerReady(host, device.db_id)
    : await withStartSlot(box, () => ensureContainerReady(host, device.db_id));
  if (wasStarted) {
    await supabase.from("devices").update({ state: "running", last_seen: new Date().toISOString() }).eq("id", device.id);
    broadcastAccountEvent(avatar.account_id, "devices", { action: "state_changed" });
  }

  // The v2 agent may lag the boot (host still routing to the old IP); its
  // line decides how the reader refreshes the tree, so it is worth the wait.
  const { version } = await waitForControlApi(host, device.db_id, { timeoutMs: wasStarted ? 45_000 : 10_000 });
  const agentLine = version?.agentLine ?? device.agent_line ?? null;
  if (version?.agentLine && version.agentLine !== device.agent_line) {
    await supabase
      .from("devices")
      .update({ agent_line: version.agentLine, agent_checked_at: new Date().toISOString() })
      .eq("id", device.id);
  }

  const originalIme = await getCurrentIme(host, device.db_id).catch(() => null);
  const { data: usage } = await supabase
    .from("avatar_usage_sessions")
    .insert({ account_id: avatar.account_id, avatar_id: avatar.id, actor_type: "maintainer" })
    .select("id")
    .maybeSingle();

  const dev: DeviceRef = {
    tunnelHostname: host,
    dbId: device.db_id,
    deviceId: device.id,
    agentLine,
    locale: device.locale,
  };

  return {
    dev,
    avatar: avatar as SessionAvatar,
    device: device as SessionDevice,
    box,
    platform: task.platform,
    wasStarted,
    close: async () => {
      if (originalIme) await restoreIme(host, device.db_id, originalIme).catch(() => undefined);
      if (usage?.id) {
        await supabase
          .from("avatar_usage_sessions")
          .update({ ended_at: new Date().toISOString(), last_seen_at: new Date().toISOString() })
          .eq("id", usage.id);
      }
      await stopContainerIfIdle(host, device.db_id, device.id, supabase);
    },
  };
}
