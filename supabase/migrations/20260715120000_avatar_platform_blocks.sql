-- Per-(avatar, platform) operational block — the single source of truth for
-- "may the Automator call this avatar on this platform right now?".
--
-- Before this table, the ONLY selection gate was a magic-string tag
-- (`blocked_twitter` / `blocked_tiktok`) buried in `avatars.tags`, written on
-- account-level on-device failures and cleared only by hand-editing raw tags.
-- Off-device TikHub verdicts (`avatar_platform_health` suspended/notfound) and
-- the shadow-ban signal (posts sent, never confirmed) never gated anything, so
-- dead/suspended/shadow-banned accounts kept being called and kept failing.
--
-- This table replaces the tag with a real relational model:
--   - one ACTIVE block per (avatar, platform) => avatar not callable there,
--   - `resolved_at IS NULL` = active; the partial unique index enforces "at
--     most one active block per (avatar, platform)",
--   - written automatically by the pipeline executor (on-device failures) and
--     the account-health worker (TikHub suspended/notfound + shadow-ban),
--     cleared by an explicit operator "Mark resolved" action.
--
-- Written by the service role (executor + worker + resolve action, which all
-- bypass RLS). Read by account members for the operator/automator UI.

create table if not exists public.avatar_platform_blocks (
  id                uuid primary key default gen_random_uuid(),
  avatar_id         uuid not null references public.avatars(id) on delete cascade,
  platform          text not null
                      check (platform in ('twitter', 'tiktok', 'reddit', 'instagram')),
  -- Why the avatar can't be called. Mirrors the operator-facing health kinds:
  --   logged_out / blocked / captcha — on-device, certain (we saw the screen)
  --   suspended / notfound           — off-device TikHub verdict
  --   shadow_ban                     — posts left the device, never confirmed
  --   manual                         — an operator blocked it by hand
  reason            text not null
                      check (reason in ('logged_out', 'blocked', 'captcha',
                                        'suspended', 'notfound', 'shadow_ban',
                                        'manual')),
  -- Where the evidence came from — drives the auto-recover policy: the worker
  -- may auto-close its own derived blocks (tikhub/verification) when the signal
  -- clears, but NEVER an on_device/operator block (those need a human).
  source            text not null
                      check (source in ('on_device', 'tikhub', 'verification',
                                        'operator')),
  -- Human context (parsed error message, TikHub note…) for the operator.
  detail            text,
  -- The job that triggered an on-device block, for a one-click trail. Nulled if
  -- the job row is later purged.
  job_id            uuid references public.campaign_jobs(id) on delete set null,
  first_detected_at timestamptz not null default now(),
  last_detected_at  timestamptz not null default now(),
  -- Null while the block is active. Set by the operator "resolved" action (or
  -- the worker auto-recover). resolved_by is null for automatic recoveries.
  resolved_at       timestamptz,
  resolved_by       uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.avatar_platform_blocks is
  'Per-(avatar, platform) operational block: the single gate for Automator avatar selection. Active = resolved_at IS NULL. Written by service role (executor + health worker + operator resolve action); read by account members.';

-- At most one ACTIVE block per (avatar, platform). Also the arbiter that makes
-- a concurrent double-open fail cleanly (handled idempotently in code).
create unique index if not exists avatar_platform_blocks_active_uniq
  on public.avatar_platform_blocks (avatar_id, platform)
  where resolved_at is null;

-- Hot path: "give me the active blocks for these avatars" (selector + UI).
create index if not exists avatar_platform_blocks_active_lookup
  on public.avatar_platform_blocks (avatar_id, platform)
  where resolved_at is null;

alter table public.avatar_platform_blocks enable row level security;

-- Account members may read their avatars' blocks — mirrors
-- `account_users_read_avatar_platform_health`.
create policy "account_users_read_avatar_platform_blocks"
  on public.avatar_platform_blocks for select
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

-- Admins have full access — mirrors `admin_full_access_avatar_platform_health`.
create policy "admin_full_access_avatar_platform_blocks"
  on public.avatar_platform_blocks for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'::user_role
    )
  );

-- ---------------------------------------------------------------------------
-- Backfill (retro_all) — seed active blocks from every current signal, most
-- certain first. ON CONFLICT DO NOTHING against the partial unique index keeps
-- the highest-priority reason when several apply to the same (avatar, platform).
-- ---------------------------------------------------------------------------

-- 1. On-device account failures — the newest failed job per (avatar, platform).
insert into public.avatar_platform_blocks
  (avatar_id, platform, reason, source, detail, first_detected_at, last_detected_at)
select lf.avatar_id, lf.platform,
       case lf.category
         when 'account_logged_out' then 'logged_out'
         when 'account_blocked'    then 'blocked'
         when 'account_captcha'    then 'captcha'
       end,
       'on_device',
       'Backfilled from latest failed job',
       lf.completed_at, lf.completed_at
from (
  select distinct on (avatar_id, platform)
         avatar_id, platform, completed_at,
         substring(error_message from '^\[([a-z_]+)\]') as category
  from public.campaign_jobs
  where status = 'failed' and completed_at > now() - interval '30 days'
  order by avatar_id, platform, completed_at desc
) lf
join public.avatars a on a.id = lf.avatar_id and a.archived_at is null
where lf.category in ('account_logged_out', 'account_blocked', 'account_captcha')
on conflict (avatar_id, platform) where resolved_at is null do nothing;

-- 2. Legacy `blocked_{platform}` tags (reason unknown -> generic blocked).
insert into public.avatar_platform_blocks
  (avatar_id, platform, reason, source, detail)
select a.id, plat.platform, 'blocked', 'on_device', 'Backfilled from legacy blocked tag'
from public.avatars a
cross join (values ('twitter'::text), ('tiktok'::text)) as plat(platform)
where a.archived_at is null
  and a.tags ? ('blocked_' || plat.platform)
on conflict (avatar_id, platform) where resolved_at is null do nothing;

-- 3. TikHub suspended.
insert into public.avatar_platform_blocks
  (avatar_id, platform, reason, source, detail, first_detected_at, last_detected_at)
select h.avatar_id, h.platform, 'suspended', 'tikhub', 'Backfilled from TikHub suspended',
       h.checked_at, h.checked_at
from public.avatar_platform_health h
join public.avatars a on a.id = h.avatar_id and a.archived_at is null
where h.status = 'suspended'
on conflict (avatar_id, platform) where resolved_at is null do nothing;

-- 4. TikHub notfound WITHOUT any confirmed post (a notfound WITH confirmed posts
--    is just a wrong stored @handle on a working account -> not blocked).
insert into public.avatar_platform_blocks
  (avatar_id, platform, reason, source, detail, first_detected_at, last_detected_at)
select h.avatar_id, h.platform, 'notfound', 'tikhub', 'Backfilled from TikHub notfound',
       h.checked_at, h.checked_at
from public.avatar_platform_health h
join public.avatars a on a.id = h.avatar_id and a.archived_at is null
where h.status = 'notfound'
  and not exists (
    select 1 from public.campaign_jobs j
    where j.avatar_id = h.avatar_id and j.platform = h.platform
      and j.status = 'done' and j.verification = 'confirmed'
      and j.completed_at > now() - interval '30 days'
  )
on conflict (avatar_id, platform) where resolved_at is null do nothing;

-- 5. Shadow-ban — done posts in the last 7 days, at least one unconfirmed and
--    ZERO confirmed.
insert into public.avatar_platform_blocks
  (avatar_id, platform, reason, source, detail)
select s.avatar_id, s.platform, 'shadow_ban', 'verification',
       'Backfilled from unconfirmed posts (no confirmation in 7d)'
from (
  select avatar_id, platform,
         count(*) filter (where verification = 'confirmed')   as confirmed,
         count(*) filter (where verification = 'unconfirmed') as unconfirmed
  from public.campaign_jobs
  where status = 'done' and completed_at > now() - interval '7 days'
  group by avatar_id, platform
) s
join public.avatars a on a.id = s.avatar_id and a.archived_at is null
where s.unconfirmed > 0 and s.confirmed = 0
on conflict (avatar_id, platform) where resolved_at is null do nothing;

-- ---------------------------------------------------------------------------
-- Retire the magic-string gate: drop the `blocked_*` tags now that the block
-- table owns selection gating (removes the double logic).
-- ---------------------------------------------------------------------------
update public.avatars
set tags = (tags - 'blocked_twitter') - 'blocked_tiktok',
    updated_at = now()
where tags ? 'blocked_twitter' or tags ? 'blocked_tiktok';
