import { z } from "zod";
import { SOCIAL_PLATFORMS } from "@/types";

/** Shared by the Server Actions and the native REST routes of the maintenance layer. */

export const maintenancePatchSchema = z.object({
  enabled: z.boolean().optional(),
  profile: z.enum(["new", "mature"]).optional(),
  dayZero: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export type MaintenancePatchInput = z.input<typeof maintenancePatchSchema>;

export const requestTaskSchema = z.object({
  kind: z.enum(["probe", "app_check", "coherence", "dismiss_dialogs"]),
  platform: z.enum(SOCIAL_PLATFORMS).nullable(),
});
export type RequestTaskInput = z.input<typeof requestTaskSchema>;

export const armyBriefSchema = z.object({
  objective: z.string().max(2_000),
  clusterKeywords: z.array(z.string().min(1).max(60)).max(30),
});
export type ArmyBriefInput = z.input<typeof armyBriefSchema>;
