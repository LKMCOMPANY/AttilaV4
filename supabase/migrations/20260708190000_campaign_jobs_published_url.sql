-- Direct link to the reply the avatar itself published (as opposed to
-- `post_url`, which is the TARGET post it replied to).
--
-- Captured by the deferred TikHub verify pass on a `confirmed` Twitter reply:
-- TikHub hands back the reply's tweet id, so we can build
-- `https://x.com/<handle>/status/<id>` — a one-click link to the live reply for
-- the operator, beyond the on-device screenshot. Twitter only: TikTok exposes
-- no stable per-comment URL, so it stays null there.
alter table public.campaign_jobs
  add column if not exists published_url text;

comment on column public.campaign_jobs.published_url is
  'Direct URL to the avatar''s OWN published reply/post (not the target). Set by the TikHub verify pass on a confirmed Twitter reply; null for TikTok (no stable per-comment URL).';
