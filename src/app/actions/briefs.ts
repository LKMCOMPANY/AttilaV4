"use server";

import { z } from "zod";
import { requireActionSession } from "@/lib/auth/session";
import {
  compileArmyBriefCore,
  compileAvatarBriefCore,
  getArmyBriefCore,
  setArmyBriefCore,
} from "@/lib/operator/briefs";
import { armyBriefSchema, type ArmyBriefInput } from "@/lib/validation/maintenance";
import type { ArmyBrief, AvatarBrief } from "@/types";

/**
 * Briefs — the web transport of the cores in `lib/operator/briefs` (the macOS
 * app reaches the same cores through `/api/armies/[id]/brief/**` and
 * `/api/avatars/[id]/brief/compile`).
 */

const idSchema = z.string().uuid();

export async function getArmyBrief(armyId: string): Promise<{ brief: ArmyBrief | null } | { error: string }> {
  const parsed = idSchema.safeParse(armyId);
  if (!parsed.success) return { error: "Identifiant invalide" };
  const ctx = await requireActionSession();
  return getArmyBriefCore(ctx, parsed.data);
}

export async function setArmyBrief(armyId: string, input: ArmyBriefInput): Promise<{ brief: ArmyBrief } | { error: string }> {
  const id = idSchema.safeParse(armyId);
  const body = armyBriefSchema.safeParse(input);
  if (!id.success || !body.success) return { error: "Paramètres invalides" };
  const ctx = await requireActionSession();
  return setArmyBriefCore(ctx, id.data, body.data);
}

export async function compileArmyBrief(armyId: string): Promise<{ compiled: number; failed: number } | { error: string }> {
  const parsed = idSchema.safeParse(armyId);
  if (!parsed.success) return { error: "Identifiant invalide" };
  const ctx = await requireActionSession();
  return compileArmyBriefCore(ctx, parsed.data);
}

export async function compileAvatarBrief(avatarId: string): Promise<{ brief: AvatarBrief } | { error: string }> {
  const parsed = idSchema.safeParse(avatarId);
  if (!parsed.success) return { error: "Identifiant invalide" };
  const ctx = await requireActionSession();
  return compileAvatarBriefCore(ctx, parsed.data);
}
