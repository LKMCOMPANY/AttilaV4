/**
 * Attention queue core — the single list of things a human must do, at
 * three scopes (avatar × platform, device, box).
 *
 * Lifecycle: `open` (detected) → `in_progress` (acknowledged) →
 * `done_pending_reprobe` (the operator says it is fixed) → `resolved` (a
 * later probe agrees) or `reopened` (it does not; `reopen_count` grows and
 * the priority with it). Detection is idempotent: re-detecting an open item
 * bumps `last_seen_at` and merges the evidence instead of duplicating.
 *
 * `avatar_platform_blocks` stays the Automator's gate; an account-scope item
 * may point at the block it was opened alongside (`block_id`) so resolving
 * one can close the other.
 *
 * Every mutation goes through here — Server Actions (web) and Route Handlers
 * (macOS) are thin wrappers.
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import type { JobErrorCategory } from "@/lib/automation/errors";
import type {
  AttentionEvidence,
  AttentionItem,
  AttentionReason,
  AttentionScope,
  AttentionSeverity,
  AttentionSource,
  SocialPlatform,
} from "@/types";
import { broadcastAccountEvent } from "@/lib/supabase/realtime";
import { audit } from "./audit";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface OpenAttentionInput {
  accountId: string;
  scope: AttentionScope;
  avatarId?: string | null;
  platform?: SocialPlatform | null;
  deviceId?: string | null;
  boxId?: string | null;
  reason: AttentionReason;
  severity: AttentionSeverity;
  title: string;
  detail?: string | null;
  evidence?: AttentionEvidence;
  source: AttentionSource;
  blockId?: string | null;
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = { info: 0, warning: 1, critical: 2 };

function targetKey(input: Pick<OpenAttentionInput, "scope" | "avatarId" | "platform" | "deviceId" | "boxId">): string {
  return [input.scope, input.avatarId ?? "", input.platform ?? "", input.deviceId ?? "", input.boxId ?? ""].join(":");
}

/**
 * Open an item, or refresh the open one for the same target and reason.
 * Returns the row id and whether it was newly created.
 */
export async function openAttention(
  supabase: AdminClient,
  input: OpenAttentionInput,
): Promise<{ id: string; created: boolean; reopened: boolean }> {
  const { data: existing } = await supabase
    .from("attention_items")
    .select("id, status, severity, evidence, reopen_count")
    .eq("account_id", input.accountId)
    .eq("target_key", targetKey(input))
    .eq("reason", input.reason)
    .is("resolved_at", null)
    .maybeSingle();

  const now = new Date().toISOString();
  if (existing) {
    const reopened = existing.status === "done_pending_reprobe";
    const severity =
      SEVERITY_RANK[input.severity] > SEVERITY_RANK[existing.severity as AttentionSeverity]
        ? input.severity
        : (existing.severity as AttentionSeverity);
    await supabase
      .from("attention_items")
      .update({
        last_seen_at: now,
        severity,
        detail: input.detail ?? undefined,
        evidence: { ...(existing.evidence as AttentionEvidence), ...(input.evidence ?? {}) },
        block_id: input.blockId ?? undefined,
        ...(reopened
          ? { status: "reopened", reopen_count: (existing.reopen_count ?? 0) + 1, done_at: null, done_by: null }
          : {}),
      })
      .eq("id", existing.id);
    if (reopened) {
      await audit(supabase, {
        actorType: "system",
        accountId: input.accountId,
        action: "attention.reopen",
        targetType: "attention_item",
        targetId: existing.id,
        detail: { reason: input.reason, source: input.source },
      });
      broadcastAccountEvent(input.accountId, "attention", { action: "reopened", id: existing.id });
    }
    return { id: existing.id, created: false, reopened };
  }

  const { data: created, error } = await supabase
    .from("attention_items")
    .insert({
      account_id: input.accountId,
      scope: input.scope,
      avatar_id: input.avatarId ?? null,
      platform: input.platform ?? null,
      device_id: input.deviceId ?? null,
      box_id: input.boxId ?? null,
      reason: input.reason,
      severity: input.severity,
      title: input.title,
      detail: input.detail ?? null,
      evidence: input.evidence ?? {},
      source: input.source,
      block_id: input.blockId ?? null,
      opened_at: now,
      last_seen_at: now,
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(`attention_items insert failed: ${error?.message ?? "no row"}`);

  await audit(supabase, {
    actorType: input.source === "operator" ? "user" : "system",
    accountId: input.accountId,
    action: "attention.open",
    targetType: "attention_item",
    targetId: created.id,
    detail: { reason: input.reason, scope: input.scope, severity: input.severity, source: input.source },
  });
  broadcastAccountEvent(input.accountId, "attention", { action: "opened", id: created.id });
  return { id: created.id, created: true, reopened: false };
}

/** The operator has seen it and is on it. */
export async function acknowledgeAttention(supabase: AdminClient, id: string, userId: string): Promise<AttentionItem | null> {
  const { data } = await supabase
    .from("attention_items")
    .update({ status: "in_progress", acknowledged_by: userId, acknowledged_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["open", "reopened"])
    .select("*")
    .maybeSingle();
  if (data) {
    await audit(supabase, { actorType: "user", actorId: userId, accountId: data.account_id, action: "attention.acknowledge", targetType: "attention_item", targetId: id });
  }
  return (data as AttentionItem | null) ?? null;
}

/**
 * The operator says it is fixed. Account-scope items wait for a probe to
 * confirm (`done_pending_reprobe`); device- and box-scope items, whose fix is
 * verifiable by the next reconcile or boot, are treated the same way. Nothing
 * is resolved on a human's word alone.
 */
export async function markAttentionDone(supabase: AdminClient, id: string, userId: string): Promise<AttentionItem | null> {
  const { data } = await supabase
    .from("attention_items")
    .update({ status: "done_pending_reprobe", done_by: userId, done_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["open", "in_progress", "reopened"])
    .select("*")
    .maybeSingle();
  if (data) {
    await audit(supabase, { actorType: "user", actorId: userId, accountId: data.account_id, action: "attention.done", targetType: "attention_item", targetId: id });
  }
  return (data as AttentionItem | null) ?? null;
}

export type ResolvedBy = "reprobe" | "reconcile" | "operator" | "system";

/** A probe (or the operator, for informational items) confirmed the fix. */
export async function resolveAttention(
  supabase: AdminClient,
  id: string,
  by: ResolvedBy,
  detail?: Record<string, unknown>,
  userId?: string | null,
): Promise<void> {
  const { data } = await supabase
    .from("attention_items")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", id)
    .is("resolved_at", null)
    .select("account_id")
    .maybeSingle();
  if (data) {
    await audit(supabase, {
      actorType: by === "operator" ? "user" : "system",
      actorId: userId ?? null,
      accountId: data.account_id,
      action: "attention.resolve",
      targetType: "attention_item",
      targetId: id,
      detail: { by, ...(detail ?? {}) },
    });
    broadcastAccountEvent(data.account_id, "attention", { action: "resolved", id });
  }
}

/** Resolve every open item on a target (all reasons, or one), e.g. after a healthy probe. */
export async function resolveAttentionForTarget(
  supabase: AdminClient,
  target: Pick<OpenAttentionInput, "accountId" | "scope" | "avatarId" | "platform" | "deviceId" | "boxId">,
  by: ResolvedBy,
  reasons?: readonly AttentionReason[],
): Promise<number> {
  let query = supabase
    .from("attention_items")
    .select("id")
    .eq("account_id", target.accountId)
    .eq("target_key", targetKey(target))
    .is("resolved_at", null);
  if (reasons && reasons.length > 0) query = query.in("reason", [...reasons]);
  const { data } = await query;
  for (const row of data ?? []) await resolveAttention(supabase, row.id, by);
  return data?.length ?? 0;
}

// ---------------------------------------------------------------------------
// From a typed job failure to an attention item
// ---------------------------------------------------------------------------

export interface AttentionFromError {
  reason: AttentionReason;
  severity: AttentionSeverity;
  title: string;
}

/**
 * Which account-scope item a job failure opens, if any. Only categories that
 * need a human: transient, content and infrastructure failures do not.
 */
export function attentionFromJobError(category: JobErrorCategory | undefined, message: string | null | undefined): AttentionFromError | null {
  switch (category) {
    case "account_logged_out":
      return { reason: "needs_login", severity: "critical", title: "Session expirée — reconnexion nécessaire" };
    case "account_captcha":
      return { reason: "captcha", severity: "critical", title: "Vérification de sécurité à passer" };
    case "account_blocked":
      return { reason: "suspended_decision", severity: "critical", title: "Compte bloqué ou suspendu — décision à prendre" };
    case "device_setup_required": {
      const lower = (message ?? "").toLowerCase();
      if (lower.includes("adbkeyboard")) return { reason: "adbkeyboard_missing", severity: "warning", title: "ADBKeyboard absent du device" };
      if (lower.includes("out of date") || lower.includes("build refused") || lower.includes("update the apk")) {
        return { reason: "app_outdated", severity: "warning", title: "Application refusée par la plateforme — APK à mettre à jour" };
      }
      return { reason: "app_missing", severity: "warning", title: "Application absente du device" };
    }
    default:
      return null;
  }
}
