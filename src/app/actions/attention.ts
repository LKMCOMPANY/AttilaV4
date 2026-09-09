"use server";

import { z } from "zod";
import { requireActionSession } from "@/lib/auth/session";
import {
  acknowledgeAttentionCore,
  listAttentionCore,
  markAttentionDoneCore,
  resolveAttentionCore,
  type AttentionMutationResult,
} from "@/lib/operator/attention";
import type { AttentionQueueItem } from "@/types";

/**
 * Attention queue — the web transport of the cores in `lib/operator/attention`
 * (the macOS app reaches the same cores through `/api/attention/**`).
 */

const idSchema = z.string().uuid();

export async function listAttentionItems(): Promise<AttentionQueueItem[]> {
  const ctx = await requireActionSession();
  const { items } = await listAttentionCore(ctx);
  return items;
}

export async function acknowledgeAttentionItem(id: string): Promise<AttentionMutationResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { error: "Identifiant invalide" };
  const ctx = await requireActionSession();
  return acknowledgeAttentionCore(ctx, parsed.data);
}

export async function markAttentionItemDone(id: string): Promise<AttentionMutationResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { error: "Identifiant invalide" };
  const ctx = await requireActionSession();
  return markAttentionDoneCore(ctx, parsed.data);
}

export async function resolveAttentionItem(id: string): Promise<{ ok: true } | { error: string }> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { error: "Identifiant invalide" };
  const ctx = await requireActionSession();
  return resolveAttentionCore(ctx, parsed.data);
}
