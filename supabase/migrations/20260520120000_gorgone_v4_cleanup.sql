-- ============================================================================
-- Attila V4 — Gorgone V4 cleanup (Phase 6, run after 24h+ of stable V4 traffic)
-- ============================================================================
-- This migration drops the V3 surface that the application no longer reads
-- or writes. Apply it ONLY after:
--
--   1. The 20260519121000 migration is live in production for at least 24h.
--   2. Render logs show successful webhook deliveries and zero referenced
--      legacy table errors in the pipeline.
--   3. `select count(*) from public.gorgone_post_jobs` shows traffic and
--      `gorgone_post_jobs.status` distribution looks healthy (a healthy mix
--      of `processed` / `filtered_out`, low `error`).
--
-- Until then, the V3 tables stay in place as historical archives.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop the V3 ingestion tables (data archived in campaign_posts)
-- ---------------------------------------------------------------------------
drop table if exists public.gorgone_tweets cascade;
drop table if exists public.gorgone_tiktok_videos cascade;

-- ---------------------------------------------------------------------------
-- 2. Drop the V3 RPC + per-zone state table that the new ledger replaces
-- ---------------------------------------------------------------------------
drop function if exists public.claim_pending_post(text);
drop function if exists public.register_gorgone_event(uuid, uuid, text, text, timestamptz, uuid, text);
drop table if exists public.gorgone_zone_state cascade;

-- ---------------------------------------------------------------------------
-- 3. Drop the legacy `gorgone_client_id` column on gorgone_links
--    (replaced by `gorgone_account_id` since the V4 migration). Make
--    `gorgone_account_id` NOT NULL now that nothing writes the old column.
-- ---------------------------------------------------------------------------
alter table public.gorgone_links
  drop column if exists gorgone_client_id;

alter table public.gorgone_links
  alter column gorgone_account_id set not null;

-- ---------------------------------------------------------------------------
-- 4. Tighten the campaign_posts CHECK on source_table now that all writes
--    go through `gorgone_post_jobs`. We allow legacy values too because
--    historical rows from before the V4 cutover keep their original
--    source_table label for analytics integrity.
-- ---------------------------------------------------------------------------
alter table public.campaign_posts
  drop constraint if exists campaign_posts_source_table_check;

alter table public.campaign_posts
  add constraint campaign_posts_source_table_check
  check (source_table in ('gorgone_post_jobs','gorgone_tweets','gorgone_tiktok_videos'));

-- Add the source_network CHECK now that backfill is done.
alter table public.campaign_posts
  drop constraint if exists campaign_posts_source_network_check;

alter table public.campaign_posts
  add constraint campaign_posts_source_network_check
  check (
    source_network is null
    or source_network in ('twitter','tiktok','instagram','youtube','reddit')
  );
