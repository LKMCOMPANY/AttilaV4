"use server";

import { z } from "zod";
import { requireActionSession } from "@/lib/auth/session";
import {
  cancelMaintenanceTaskCore,
  getAvatarMaintenanceCore,
  requestMaintenanceTaskNowCore,
  setAvatarMaintenanceCore,
  signMaintenanceProofCore,
  type AvatarMaintenanceOverview,
} from "@/lib/operator/maintenance";
import { maintenancePatchSchema, requestTaskSchema, type MaintenancePatchInput, type RequestTaskInput } from "@/lib/validation/maintenance";

/**
 * Maintenance — the web transport of the cores in `lib/operator/maintenance`
 * (the macOS app reaches the same cores through `/api/avatars/[id]/maintenance/**`).
 */

const idSchema = z.string().uuid();

export async function getAvatarMaintenance(avatarId: string): Promise<AvatarMaintenanceOverview | { error: string }> {
  const parsed = idSchema.safeParse(avatarId);
  if (!parsed.success) return { error: "Identifiant invalide" };
  const ctx = await requireActionSession();
  return getAvatarMaintenanceCore(ctx, parsed.data);
}

export async function setAvatarMaintenance(
  avatarId: string,
  patch: MaintenancePatchInput,
): Promise<{ ok: true } | { error: string }> {
  const id = idSchema.safeParse(avatarId);
  const body = maintenancePatchSchema.safeParse(patch);
  if (!id.success || !body.success) return { error: "Paramètres invalides" };
  const ctx = await requireActionSession();
  return setAvatarMaintenanceCore(ctx, id.data, body.data);
}

export async function requestMaintenanceTaskNow(
  avatarId: string,
  input: RequestTaskInput,
): Promise<{ taskId: string } | { error: string }> {
  const id = idSchema.safeParse(avatarId);
  const body = requestTaskSchema.safeParse(input);
  if (!id.success || !body.success) return { error: "Paramètres invalides" };
  const ctx = await requireActionSession();
  return requestMaintenanceTaskNowCore(ctx, id.data, body.data.kind, body.data.platform);
}

export async function cancelMaintenanceTask(taskId: string): Promise<{ ok: true } | { error: string }> {
  const parsed = idSchema.safeParse(taskId);
  if (!parsed.success) return { error: "Identifiant invalide" };
  const ctx = await requireActionSession();
  return cancelMaintenanceTaskCore(ctx, parsed.data);
}

export async function signMaintenanceProof(path: string): Promise<{ url: string; expiresAt: string } | { error: string }> {
  if (typeof path !== "string" || path.length > 400) return { error: "Chemin invalide" };
  const ctx = await requireActionSession();
  return signMaintenanceProofCore(ctx, path);
}
