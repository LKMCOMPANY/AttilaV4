-- Author profile image for the source post, so the automator posts list can
-- show who was replied to at a glance (not just the @handle).
--
-- Populated at ingestion from Gorgone's harvested `author.avatar_url` — no new
-- network call. Nullable: older rows and posts without a harvested avatar stay
-- null, and the UI falls back to the author's initials. Twitter avatar URLs
-- are stable; TikTok's are signed and may expire, which the initials fallback
-- handles gracefully (no broken image).
alter table public.campaign_posts
  add column if not exists author_avatar_url text;

comment on column public.campaign_posts.author_avatar_url is
  'Source post author profile image URL, harvested by Gorgone at ingestion. Nullable; UI falls back to initials when absent or expired.';
