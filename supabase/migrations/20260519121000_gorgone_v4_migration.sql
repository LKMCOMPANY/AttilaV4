-- ============================================================================
-- Attila V4 — Migration to Gorgone V4 ingestion model
-- ============================================================================
-- Replaces the V3 dual-cache (`gorgone_tweets` + `gorgone_tiktok_videos`)
-- with a single lightweight ledger (`gorgone_post_jobs`). The actual post
-- payload now lives only in Gorgone V4 (`public.posts`); Attila re-fetches
-- on demand when the pipeline claims a job.
--
-- This migration is non-destructive — the V3 tables stay around until the
-- final cleanup migration (Phase 6) so the rollout can be staged:
--   1. Apply this migration (additive).
--   2. Deploy Attila code reading from gorgone_post_jobs.
--   3. Verify pipeline health for 24h.
--   4. Drop V3 tables in the cleanup migration.
--
-- Three changes:
--
--   1. `gorgone_links.gorgone_account_id` (NEW NULLABLE column)
--      Renames `gorgone_client_id` semantically — Gorgone V4 has no
--      `clients` table. Backfilled with the existing client_id values
--      (which were really account_ids cosplaying as client_ids in V3).
--      Made NOT NULL in the cleanup phase once nothing reads the old name.
--
--   2. `gorgone_post_jobs` (NEW TABLE)
--      The ledger. One row = "Gorgone published a post matching one of
--      our subscriptions; here's its ID + ordering metadata; pipeline
--      picks it up". No content stored — that's Gorgone's job.
--
--   3. RPC `claim_pending_job(p_zone_ids uuid[], p_networks text[])`
--      FOR UPDATE SKIP LOCKED claim. Drop-in replacement for V3's
--      `claim_pending_post(p_table text)`.
--
-- Compatibility note for `campaign_posts`:
--   `source_table` text column already accepts free-form strings; the new
--   pipeline writes `source_table = 'gorgone_post_jobs'` and a new
--   `source_network` column ('twitter'|'tiktok'|...) to keep `platform`
--   alongside the source-side discrimination. Read paths handle both
--   legacy ('gorgone_tweets'|'gorgone_tiktok_videos') and new values.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. gorgone_links.gorgone_account_id (additive)
-- ---------------------------------------------------------------------------
alter table public.gorgone_links
  add column if not exists gorgone_account_id uuid;

update public.gorgone_links
  set gorgone_account_id = gorgone_client_id
  where gorgone_account_id is null;

create index if not exists gorgone_links_account_idx
  on public.gorgone_links (gorgone_account_id)
  where is_active;

-- ---------------------------------------------------------------------------
-- 2. gorgone_post_jobs — the ledger
-- ---------------------------------------------------------------------------
create table if not exists public.gorgone_post_jobs (
  -- Primary key from Gorgone — unique per posts row
  gorgone_post_id   uuid primary key,
  gorgone_post_posted_at timestamptz not null,

  -- Tenant scoping (FK back to Attila's accounts)
  account_id        uuid not null references public.accounts(id) on delete cascade,
  zone_id           uuid not null,
  network           text not null
                      check (network in ('twitter','tiktok','instagram','youtube','reddit')),

  -- Ordering metadata (denormalised so claim doesn't need to re-fetch
  -- Gorgone just to know "which post is most worth processing next")
  collected_at      timestamptz not null,
  total_engagement  bigint not null default 0,
  kind              text not null default 'post'
                      check (kind in ('post','reply','repost','comment')),

  -- Pipeline lifecycle
  status            text not null default 'pending'
                      check (status in ('pending','processing','processed','filtered_out','error','expired')),
  status_changed_at timestamptz not null default now(),
  campaign_id       uuid,                              -- assigned after match
  error_message     text,
  delivery_source   text not null default 'webhook'
                      check (delivery_source in ('webhook','sweep')),
  attempts          smallint not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists gorgone_post_jobs_pending_idx
  on public.gorgone_post_jobs (zone_id, network, total_engagement desc, collected_at)
  where status = 'pending';

create index if not exists gorgone_post_jobs_account_status_idx
  on public.gorgone_post_jobs (account_id, status, collected_at desc);

create index if not exists gorgone_post_jobs_campaign_idx
  on public.gorgone_post_jobs (campaign_id, status_changed_at desc)
  where campaign_id is not null;

-- updated_at trigger
create or replace function public.handle_gorgone_post_jobs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  if (new.status is distinct from old.status) then
    new.status_changed_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists gorgone_post_jobs_updated_at on public.gorgone_post_jobs;
create trigger gorgone_post_jobs_updated_at
  before update on public.gorgone_post_jobs
  for each row execute function public.handle_gorgone_post_jobs_updated_at();

-- RLS — same posture as V3 tables: no user-facing reads, service-role
-- only. The Attila pipeline runs as service-role.
alter table public.gorgone_post_jobs enable row level security;

-- ---------------------------------------------------------------------------
-- 3. RPC: claim_pending_job — atomic FOR UPDATE SKIP LOCKED
-- ---------------------------------------------------------------------------
-- Picks the highest-engagement pending job within the caller's zone+network
-- filter, marks it 'processing', returns its row. Multiple concurrent fibers
-- each receive a different row (or none, if nothing pending).
--
-- p_zone_ids   — restrict to a set of zone uuids (NULL = no filter)
-- p_networks   — restrict to a set of network strings (NULL = all 5)
--
-- Both arguments default to NULL so callers without filtering needs (the
-- single-tenant pipeline today) can call `claim_pending_job()` directly.
-- Note: the RETURNS TABLE column names shadow the underlying table columns
-- inside the pl/pgsql body, so every reference to `gorgone_post_jobs` in
-- the UPDATE / RETURNING must qualify with the table alias to avoid an
-- ambiguous-column error at runtime.
create or replace function public.claim_pending_job(
  p_zone_ids uuid[] default null,
  p_networks text[] default null
)
returns table (
  gorgone_post_id uuid,
  gorgone_post_posted_at timestamptz,
  account_id uuid,
  zone_id uuid,
  network text,
  kind text,
  collected_at timestamptz,
  total_engagement bigint
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  return query
  with claimed as (
    update public.gorgone_post_jobs as t
    set status = 'processing',
        attempts = t.attempts + 1
    where t.gorgone_post_id = (
      select j.gorgone_post_id
      from public.gorgone_post_jobs j
      where j.status = 'pending'
        and (p_zone_ids is null or j.zone_id = any(p_zone_ids))
        and (p_networks is null or j.network = any(p_networks))
      order by j.total_engagement desc, j.collected_at asc
      limit 1
      for update skip locked
    )
    returning
      t.gorgone_post_id,
      t.gorgone_post_posted_at,
      t.account_id,
      t.zone_id,
      t.network,
      t.kind,
      t.collected_at,
      t.total_engagement
  )
  select
    c.gorgone_post_id,
    c.gorgone_post_posted_at,
    c.account_id,
    c.zone_id,
    c.network,
    c.kind,
    c.collected_at,
    c.total_engagement
  from claimed c;
end;
$function$;

revoke all on function public.claim_pending_job(uuid[], text[]) from public;
grant execute on function public.claim_pending_job(uuid[], text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 4. RPC: enqueue_gorgone_job — webhook + sweep both call this
-- ---------------------------------------------------------------------------
-- ON CONFLICT DO NOTHING for idempotence — same payload from webhook and
-- sweep produces a single row. Returns true if inserted, false if already
-- known (= duplicate / already enqueued by another channel).
create or replace function public.enqueue_gorgone_job(
  p_gorgone_post_id uuid,
  p_gorgone_post_posted_at timestamptz,
  p_account_id uuid,
  p_zone_id uuid,
  p_network text,
  p_kind text,
  p_collected_at timestamptz,
  p_total_engagement bigint,
  p_delivery_source text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_inserted boolean := false;
begin
  insert into public.gorgone_post_jobs (
    gorgone_post_id, gorgone_post_posted_at,
    account_id, zone_id, network, kind,
    collected_at, total_engagement, delivery_source
  ) values (
    p_gorgone_post_id, p_gorgone_post_posted_at,
    p_account_id, p_zone_id, p_network, coalesce(p_kind, 'post'),
    p_collected_at, coalesce(p_total_engagement, 0), p_delivery_source
  )
  on conflict (gorgone_post_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$function$;

revoke all on function public.enqueue_gorgone_job(uuid, timestamptz, uuid, uuid, text, text, timestamptz, bigint, text) from public;
grant execute on function public.enqueue_gorgone_job(uuid, timestamptz, uuid, uuid, text, text, timestamptz, bigint, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Soft additions to campaign_posts (network discriminator)
-- ---------------------------------------------------------------------------
alter table public.campaign_posts
  add column if not exists source_network text;

-- Backfill source_network from existing source_table values for historical
-- rows so analytics/network maps don't break post-migration.
update public.campaign_posts
  set source_network = case
    when source_table = 'gorgone_tweets' then 'twitter'
    when source_table = 'gorgone_tiktok_videos' then 'tiktok'
    else source_network
  end
  where source_network is null;

-- The CHECK constraint on source_network is added in cleanup (after every
-- new write has been observed to set it correctly).

-- ---------------------------------------------------------------------------
-- 6. Comment trail
-- ---------------------------------------------------------------------------
comment on table public.gorgone_post_jobs is
  'Lightweight ledger of posts forwarded by Gorgone V4. Replaces the V3 gorgone_tweets/gorgone_tiktok_videos cache. The full post payload lives in Gorgone — Attila re-fetches on claim.';

comment on column public.gorgone_links.gorgone_account_id is
  'Gorgone V4 account UUID this Attila account is linked to (replaces gorgone_client_id from V3 vocabulary).';
