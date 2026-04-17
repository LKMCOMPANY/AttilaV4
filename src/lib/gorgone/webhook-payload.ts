import { z } from "zod";

/**
 * Webhook payload schemas — v2.
 *
 * These describe the JSON body sent by the Gorgone Postgres triggers
 * (`notify_attila_new_tweet` / `notify_attila_new_tiktok`) to
 * `POST /api/gorgone/webhook`.
 *
 * The shape is intentionally rich: every field needed by the campaign
 * filters (see `src/lib/pipeline/filter.ts`) is included so the pipeline
 * never needs to query Gorgone again after ingestion.
 *
 * Versioned via the `version` field so future schema migrations can be
 * negotiated end-to-end without breaking existing payloads.
 */

const isoDate = z.string().datetime({ offset: true });
const uuid = z.string().uuid();

const tweetData = z.object({
  // Identity
  gorgone_id: uuid,
  zone_id: uuid,
  zone_name: z.string(),
  client_id: uuid,
  tweet_id: z.string(),
  conversation_id: z.string().nullable(),

  // Content
  text: z.string(),
  lang: z.string().nullable(),
  is_reply: z.boolean(),
  in_reply_to_tweet_id: z.string().nullable(),
  tweet_url: z.string().nullable(),

  // Timestamps
  twitter_created_at: isoDate,
  collected_at: isoDate,

  // Engagement
  retweet_count: z.number().int().nonnegative(),
  reply_count: z.number().int().nonnegative(),
  like_count: z.number().int().nonnegative(),
  quote_count: z.number().int().nonnegative(),
  view_count: z.number().int().nonnegative(),
  total_engagement: z.number().int().nonnegative(),

  // Author (denormalized at trigger time)
  author_username: z.string().nullable(),
  author_name: z.string().nullable(),
  author_followers: z.number().int().nonnegative(),
  author_verified: z.boolean(),
  author_profile_picture: z.string().nullable(),
});

const tiktokData = z.object({
  gorgone_id: uuid,
  zone_id: uuid,
  zone_name: z.string(),
  client_id: uuid,
  video_id: z.string(),

  description: z.string().nullable(),
  language: z.string().nullable(),
  share_url: z.string().nullable(),
  is_ad: z.boolean(),

  tiktok_created_at: isoDate,
  collected_at: isoDate,

  play_count: z.number().int().nonnegative(),
  digg_count: z.number().int().nonnegative(),
  comment_count: z.number().int().nonnegative(),
  share_count: z.number().int().nonnegative(),
  collect_count: z.number().int().nonnegative(),
  total_engagement: z.number().int().nonnegative(),

  author_username: z.string().nullable(),
  author_nickname: z.string().nullable(),
  author_followers: z.number().int().nonnegative(),
  author_verified: z.boolean(),
  author_is_private: z.boolean(),
  author_avatar: z.string().nullable(),
});

export const webhookPayloadSchema = z.discriminatedUnion("event", [
  z.object({
    version: z.literal(2),
    event: z.literal("tweet.created"),
    delivered_at: isoDate,
    data: tweetData,
  }),
  z.object({
    version: z.literal(2),
    event: z.literal("tiktok.created"),
    delivered_at: isoDate,
    data: tiktokData,
  }),
]);

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
export type TweetPayloadData = z.infer<typeof tweetData>;
export type TiktokPayloadData = z.infer<typeof tiktokData>;
