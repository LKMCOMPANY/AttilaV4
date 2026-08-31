import { z } from "zod";

/**
 * Body schemas for the native automator REST routes. The Server Actions
 * receive these payloads pre-typed from our own React components; the
 * REST surface receives untrusted JSON from the wire, so every campaign
 * write is whitelisted here before it reaches the cores. Unknown keys
 * are stripped (zod default) — a patch can never smuggle a column the
 * surface does not declare.
 *
 * `filters` and `capacity_params` are free-form config blobs by design
 * (the pipeline validates semantics at run time), so they are checked
 * structurally as objects only — exact parity with the action inputs.
 */

const campaignPlatformSchema = z.enum(["twitter", "tiktok"]);
const campaignStatusSchema = z.enum(["draft", "active", "paused", "archived"]);
const configBlobSchema = z.record(z.string(), z.unknown());

const platformCapacityParamsSchema = z.object({
  max_responses_per_hour: z.number().int().min(0),
  max_responses_per_day: z.number().int().min(0),
  min_avatars_per_post: z.number().int().min(0),
  max_avatars_per_post: z.number().int().min(0),
  delay_min_seconds: z.number().int().min(0).optional(),
  delay_max_seconds: z.number().int().min(0).optional(),
  queue_max_age_minutes: z.number().int().min(0).optional(),
});

const capacityParamsSchema = z.object({
  twitter: platformCapacityParamsSchema,
  tiktok: platformCapacityParamsSchema,
});

export const createCampaignBodySchema = z.object({
  account_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  mode: z.literal("sniper"),
  platforms: z.array(campaignPlatformSchema).min(1),
  gorgone_zone_id: z.string().uuid(),
  gorgone_zone_name: z.string().nullable(),
  army_ids: z.array(z.string().uuid()),
  filters: configBlobSchema,
  capacity_params: capacityParamsSchema.optional(),
  operational_context: z.string().nullable(),
  strategy: z.string().nullable(),
  key_messages: z.string().nullable(),
});

export const updateCampaignBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  mode: z.literal("sniper").optional(),
  platforms: z.array(campaignPlatformSchema).optional(),
  gorgone_zone_id: z.string().uuid().optional(),
  gorgone_zone_name: z.string().nullable().optional(),
  army_ids: z.array(z.string().uuid()).optional(),
  filters: configBlobSchema.optional(),
  capacity_params: capacityParamsSchema.optional(),
  operational_context: z.string().nullable().optional(),
  strategy: z.string().nullable().optional(),
  key_messages: z.string().nullable().optional(),
  status: campaignStatusSchema.optional(),
  guidelines_generated_at: z.string().datetime({ offset: true }).nullable().optional(),
  guidelines_auto_update: z.boolean().optional(),
});

export const capacityEstimateBodySchema = z.object({
  zone_id: z.string().uuid(),
  platforms: z.array(campaignPlatformSchema).min(1),
  filters: configBlobSchema,
  army_ids: z.array(z.string().uuid()),
  capacity_params: capacityParamsSchema,
  account_id: z.string().uuid(),
});
