/**
 * Attention queue cores — the same logic behind the web Server Actions and
 * the macOS REST routes. Reads go through the caller's RLS-scoped client
 * (an operator sees their account's items, an admin everything); mutations
 * go through the maintenance core with the service role once the caller's
 * visibility of the item has been checked.
 */

import type { RequestSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { broadcastAccountEvent } from "@/lib/supabase/realtime";
import {
  acknowledgeAttention,
  markAttentionDone,
  resolveAttention,
} from "@/lib/maintenance/attention";
import type { AttentionItem, AttentionQueueItem } from "@/types";

export interface AttentionListResult {
  items: AttentionQueueItem[];
}

/** Open items visible to the caller, most urgent first. */
export async function listAttentionCore(ctx: RequestSession): Promise<AttentionListResult> {
  const { data, error } = await ctx.supabase
    .from("attention_queue_v")
    .select("*")
    .order("priority", { ascending: false })
    .order("opened_at", { ascending: true });
  if (error) throw new Error(`attention_queue_v: ${error.message}`);
  return { items: (data ?? []) as AttentionQueueItem[] };
}

export type AttentionMutationResult = { item: AttentionItem } | { error: string };

/** The item as the caller may see it — null when RLS hides it. */
async function visibleItem(ctx: RequestSession, id: string): Promise<{ id: string; account_id: string } | null> {
  const { data } = await ctx.supabase.from("attention_items").select("id, account_id").eq("id", id).maybeSingle();
  return data ?? null;
}

export async function acknowledgeAttentionCore(ctx: RequestSession, id: string): Promise<AttentionMutationResult> {
  const visible = await visibleItem(ctx, id);
  if (!visible) return { error: "Élément introuvable" };
  const item = await acknowledgeAttention(createAdminClient(), id, ctx.session.profile.id);
  if (!item) return { error: "Cet élément n'est plus à prendre en charge" };
  broadcastAccountEvent(visible.account_id, "attention", { action: "updated", id });
  return { item };
}

export async function markAttentionDoneCore(ctx: RequestSession, id: string): Promise<AttentionMutationResult> {
  const visible = await visibleItem(ctx, id);
  if (!visible) return { error: "Élément introuvable" };
  const item = await markAttentionDone(createAdminClient(), id, ctx.session.profile.id);
  if (!item) return { error: "Cet élément n'est plus ouvert" };
  broadcastAccountEvent(visible.account_id, "attention", { action: "updated", id });
  return { item };
}

/** Admins and managers may close an item on their own authority (audited). */
export async function resolveAttentionCore(ctx: RequestSession, id: string): Promise<{ ok: true } | { error: string }> {
  const role = ctx.session.profile.role;
  if (role !== "admin" && role !== "manager") return { error: "Réservé aux administrateurs et managers" };
  const visible = await visibleItem(ctx, id);
  if (!visible) return { error: "Élément introuvable" };
  await resolveAttention(createAdminClient(), id, "operator", undefined, ctx.session.profile.id);
  broadcastAccountEvent(visible.account_id, "attention", { action: "resolved", id });
  return { ok: true };
}
