-- ============================================================================
-- Attila V4 — Widen `campaign_posts.source_table` CHECK to accept V4 ledger
-- ============================================================================
-- The existing CHECK on `source_table` only accepted the V3 values
-- ('gorgone_tweets', 'gorgone_tiktok_videos'). The V4 pipeline writes
-- 'gorgone_post_jobs' through `processor.ts::buildCampaignPostRow`, which
-- would have crashed every INSERT once a campaign matched a V4 post —
-- latent because the freshly-linked accounts hadn't yet ingested traffic
-- end-to-end through to the campaign matcher.
--
-- This migration widens the CHECK so the next pipeline run lands
-- cleanly. The V3 values stay accepted so historical rows remain
-- readable until the V3 cleanup migration retires them.
--
-- Companion change: tightens the new `source_network` column to the five
-- Gorgone V4 networks. The column was added by the previous migration
-- but kept un-checked while we verified the backfill — now safe to
-- harden.
-- ============================================================================

alter table public.campaign_posts
  drop constraint if exists campaign_posts_source_table_check;

alter table public.campaign_posts
  add constraint campaign_posts_source_table_check
  check (source_table in ('gorgone_post_jobs', 'gorgone_tweets', 'gorgone_tiktok_videos'));

alter table public.campaign_posts
  drop constraint if exists campaign_posts_source_network_check;

alter table public.campaign_posts
  add constraint campaign_posts_source_network_check
  check (
    source_network is null
    or source_network in ('twitter', 'tiktok', 'instagram', 'youtube', 'reddit')
  );
