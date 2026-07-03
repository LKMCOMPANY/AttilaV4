/**
 * PostgREST embed normalization.
 *
 * For a to-one relationship (FK backed by a PK/unique constraint —
 * `twitter_post_extras`, `tiktok_post_extras`,
 * `twitter_social_user_extras`, `tiktok_social_user_extras`), PostgREST
 * returns the embed as a single OBJECT. Older behaviour / plural
 * spellings return a single-element ARRAY.
 *
 * Reading `embed[0]` on the object shape silently yields `undefined` —
 * which made `author_verified` and `is_ad` permanently false across the
 * pipeline (a `verified_only` campaign rejected 100% of posts). Every
 * consumer goes through this helper so both shapes are handled.
 */
export type EmbedOne<T> = T | T[] | null;

export function embedOne<T>(value: EmbedOne<T> | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
