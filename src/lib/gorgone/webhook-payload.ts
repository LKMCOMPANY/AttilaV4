import { z } from "zod";

/**
 * Webhook payload schema — v3 (Gorgone V4 → Attila).
 *
 * The Gorgone trigger (`notify_attila_new_post`) emits a *minimal* payload:
 * just IDs + ordering metadata. The pipeline re-fetches the full content
 * (text, author, network extras, sentiment, translation) from Gorgone when
 * it claims the job. This keeps the trigger fast (no synchronous joins),
 * the payload tiny (no PII drift between Gorgone and the wire), and
 * Gorgone the single source of truth for content.
 *
 * Versioning: the wire format is versioned via `version`; bumping it on
 * Gorgone's side requires updating this schema in the same change. We
 * accept v3 only — v2 (the fat V3 payload) is rejected with 400.
 */

const isoDate = z.string().datetime({ offset: true });
const uuid = z.string().uuid();

export const networkEnum = z.enum([
  "twitter",
  "tiktok",
  "instagram",
  "youtube",
  "reddit",
]);

export const postKindEnum = z.enum(["post", "reply", "repost", "comment"]);

const postCreatedData = z.object({
  post_id: uuid,
  post_posted_at: isoDate,
  account_id: uuid,
  zone_id: uuid,
  network: networkEnum,
  kind: postKindEnum,
  collected_at: isoDate,
  total_engagement: z.number().int().nonnegative(),
});

export const webhookPayloadSchema = z.object({
  version: z.literal(3),
  event: z.literal("post.created"),
  delivered_at: isoDate,
  data: postCreatedData,
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
export type PostCreatedData = z.infer<typeof postCreatedData>;
export type GorgoneWebhookNetwork = z.infer<typeof networkEnum>;
export type GorgonePostKind = z.infer<typeof postKindEnum>;
