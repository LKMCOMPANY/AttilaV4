-- Off-device account health per (avatar, platform), sourced from TikHub.
--
-- The on-device gate reports a post "done" when the composer closes — which
-- also happens on a SUSPENDED or DELETED account (the app still lets you type
-- and dismisses the composer). Those posts then show up as `verification =
-- unconfirmed` with no explanation. TikHub's public profile lookup tells us
-- WHY: the account is active (genuine shadow-ban / indexing lag), suspended,
-- or gone. This table stores that verdict per platform so both the operator
-- (account health at a glance) and the automator (why a post is unconfirmed)
-- can surface it.
--
-- Written exclusively by the account-health worker (service role, which
-- bypasses RLS). Read by account members. Purely informational — it NEVER
-- gates avatar selection or the pipeline (a false "suspended" from a scraper
-- must never silently stop a working account).

create table if not exists public.avatar_platform_health (
  id          uuid primary key default gen_random_uuid(),
  avatar_id   uuid not null references public.avatars(id) on delete cascade,
  platform    text not null
                check (platform in ('twitter', 'tiktok', 'reddit', 'instagram')),
  -- active   — profile reachable and live
  -- suspended— platform suspended/locked the account
  -- notfound — handle no longer resolves (deleted / renamed / banned)
  -- unknown  — never probed yet, or TikHub could not answer
  status      text not null default 'unknown'
                check (status in ('active', 'suspended', 'notfound', 'unknown')),
  followers   integer,
  -- Last time the worker recorded a verdict (definitive or inconclusive) —
  -- drives the staleness re-check schedule.
  checked_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (avatar_id, platform)
);

comment on table public.avatar_platform_health is
  'Off-device (TikHub) account health per (avatar, platform): active / suspended / notfound / unknown. Written by the account-health worker (service role); read by operator + automator UI. Informational only — never gates the pipeline.';

alter table public.avatar_platform_health enable row level security;

-- Account members (any role scoped to the account) may read their avatars'
-- health — mirrors `account_users_read_avatars` on the parent table.
create policy "account_users_read_avatar_platform_health"
  on public.avatar_platform_health for select
  using (
    avatar_id in (
      select avatars.id
      from public.avatars
      where avatars.account_id in (
        select profiles.account_id
        from public.profiles
        where profiles.id = auth.uid()
      )
    )
  );

-- Admins have full access — mirrors `admin_full_access_avatars`.
create policy "admin_full_access_avatar_platform_health"
  on public.avatar_platform_health for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'::user_role
    )
  );
