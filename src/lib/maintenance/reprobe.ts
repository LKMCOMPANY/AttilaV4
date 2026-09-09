import type { createAdminClient } from "@/lib/supabase/admin";
import type { AttentionReason, AttentionScope, SocialPlatform } from "@/types";
import { PRIORITY } from "./scheduler";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Reasons a probe on the device can confirm or refute once a human says "done". */
const ACCOUNT_REASONS = new Set<AttentionReason>(["needs_login", "captcha", "dialog_unknown", "suspended_decision", "email_code"]);
const DEVICE_REASONS_APP = new Set<AttentionReason>(["app_outdated", "app_missing", "adbkeyboard_missing"]);
const DEVICE_REASONS_COHERENCE = new Set<AttentionReason>(["proxy_incoherent", "timezone_incoherent", "persona_device_mismatch"]);

interface DoneItem {
  id: string;
  account_id: string;
  scope: AttentionScope;
  avatar_id: string | null;
  platform: SocialPlatform | null;
  device_id: string | null;
  reason: AttentionReason | string;
  reprobe_task_id: string | null;
}

/**
 * For every attention item in `done_pending_reprobe` without a probe on the
 * way, queue the task that can verify the fix: a `probe` of the account, an
 * `app_check` or a `coherence` of the device. The recipe resolves the item
 * (a healthy read) or reopens it (`openAttention` on the same target).
 * Items the maintainer cannot verify (a box, a manual note) stay for the
 * Reconcile worker or the operator.
 */
export async function scheduleReprobes(supabase: AdminClient): Promise<number> {
  const { data } = await supabase
    .from("attention_items")
    .select("id, account_id, scope, avatar_id, platform, device_id, reason, reprobe_task_id")
    .eq("status", "done_pending_reprobe")
    .is("resolved_at", null);
  let queued = 0;
  for (const raw of data ?? []) {
    const item = raw as DoneItem;
    if (item.reprobe_task_id && (await taskStillPending(supabase, item.reprobe_task_id))) continue;

    const kind = kindFor(item);
    if (!kind) continue;
    const avatarId = item.avatar_id ?? (await avatarOnDevice(supabase, item.device_id));
    if (!avatarId) continue;
    const deviceId = item.device_id ?? (await deviceOfAvatar(supabase, avatarId));

    const { data: task } = await supabase
      .from("maintenance_tasks")
      .insert({
        account_id: item.account_id,
        avatar_id: avatarId,
        device_id: deviceId,
        platform: item.platform,
        kind,
        priority: PRIORITY.probe + 5,
        scheduled_for: new Date().toISOString(),
        params: { reprobe_of: item.id },
        created_by: "attention_reprobe",
        attention_item_id: item.id,
      })
      .select("id")
      .maybeSingle();
    if (task?.id) {
      await supabase.from("attention_items").update({ reprobe_task_id: task.id }).eq("id", item.id);
      queued++;
    }
  }
  return queued;
}

function kindFor(item: DoneItem): "probe" | "app_check" | "coherence" | null {
  const reason = item.reason as AttentionReason;
  if (item.scope === "avatar_platform" && ACCOUNT_REASONS.has(reason)) return "probe";
  if (item.scope === "device" && DEVICE_REASONS_APP.has(reason)) return "app_check";
  if (item.scope === "device" && DEVICE_REASONS_COHERENCE.has(reason)) return "coherence";
  return null;
}

async function taskStillPending(supabase: AdminClient, taskId: string): Promise<boolean> {
  const { data } = await supabase.from("maintenance_tasks").select("status").eq("id", taskId).maybeSingle();
  return data?.status === "scheduled" || data?.status === "running";
}

async function avatarOnDevice(supabase: AdminClient, deviceId: string | null): Promise<string | null> {
  if (!deviceId) return null;
  const { data } = await supabase.from("avatars").select("id").eq("device_id", deviceId).is("archived_at", null).maybeSingle();
  return data?.id ?? null;
}

async function deviceOfAvatar(supabase: AdminClient, avatarId: string): Promise<string | null> {
  const { data } = await supabase.from("avatars").select("device_id").eq("id", avatarId).maybeSingle();
  return data?.device_id ?? null;
}
