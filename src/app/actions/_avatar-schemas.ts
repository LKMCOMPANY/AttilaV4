import { z } from "zod";
import {
  WRITING_STYLES,
  TONES,
  VOCABULARY_LEVELS,
  EMOJI_USAGES,
  AVATAR_STATUSES,
} from "@/types";

/**
 * Zod schemas for the avatar server actions. Kept in a plain module (not the
 * `"use server"` action file, which may only export async functions) so the
 * validation shape lives in one place and the action file stays under the
 * module size budget.
 */

const socialCredentialsSchema = z
  .object({
    handle: z.string().optional(),
    email: z.string().optional(),
    password: z.string().optional(),
    phone: z.string().optional(),
    user_id: z.string().optional(),
  })
  .default({});

export const createAvatarSchema = z.object({
  account_id: z.string().uuid(),
  first_name: z.string().min(1, "First name is required").max(50),
  last_name: z.string().min(1, "Last name is required").max(50),
  profile_image_url: z.string().url().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  country_code: z.string().length(2),
  language_code: z.string().min(2).max(3),
  device_id: z.string().uuid().nullable().optional(),
  writing_style: z.enum(WRITING_STYLES).default("casual"),
  tone: z.enum(TONES).default("neutral"),
  vocabulary_level: z.enum(VOCABULARY_LEVELS).default("standard"),
  emoji_usage: z.enum(EMOJI_USAGES).default("sparse"),
  personality_traits: z.array(z.string()).default([]),
  topics_expertise: z.array(z.string()).default([]),
  topics_avoid: z.array(z.string()).default([]),
  twitter_enabled: z.boolean().default(false),
  tiktok_enabled: z.boolean().default(false),
  reddit_enabled: z.boolean().default(false),
  instagram_enabled: z.boolean().default(false),
  twitter_credentials: socialCredentialsSchema,
  tiktok_credentials: socialCredentialsSchema,
  reddit_credentials: socialCredentialsSchema,
  instagram_credentials: socialCredentialsSchema,
  operator_ids: z.array(z.string().uuid()).default([]),
  army_ids: z.array(z.string().uuid()).default([]),
  new_army_names: z.array(z.string().min(1).max(100)).default([]),
});

export type CreateAvatarInput = z.infer<typeof createAvatarSchema>;

// Partial update. Network toggles and credentials are handled by dedicated
// actions (see `avatar-social`) so that toggling a network never touches
// credentials and editing one credential field never overwrites its siblings.
// `device_id` is intentionally NOT here: device attach/detach/swap goes through
// the single validated `setAvatarDevice` action (account scope + 1:1 guard).
export const updateAvatarSchema = z
  .object({
    first_name: z.string().min(1).max(50).optional(),
    last_name: z.string().min(1).max(50).optional(),
    profile_image_url: z.string().url().nullable().optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().max(30).nullable().optional(),
    country_code: z.string().length(2).optional(),
    language_code: z.string().min(2).max(3).optional(),
    writing_style: z.enum(WRITING_STYLES).optional(),
    tone: z.enum(TONES).optional(),
    vocabulary_level: z.enum(VOCABULARY_LEVELS).optional(),
    emoji_usage: z.enum(EMOJI_USAGES).optional(),
    personality_traits: z.array(z.string()).optional(),
    topics_expertise: z.array(z.string()).optional(),
    topics_avoid: z.array(z.string()).optional(),
    status: z.enum(AVATAR_STATUSES).optional(),
    tags: z.array(z.string()).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });
