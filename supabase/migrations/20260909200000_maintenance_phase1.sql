-- Phase 1 of the avatar-maintenance layer ("opérateur IA"): the twin of each
-- account on its device, the task queue the Maintain loop claims from, the
-- per-avatar maintenance switch and profile, and the briefs. Additive only;
-- writes go through the service role (server cores), clients read under RLS.

-- ---------------------------------------------------------------------------
-- avatar_platform_state — what the DEVICE last showed for one account: the
-- on-device counterpart of avatar_platform_health (TikHub). One row per
-- (avatar, platform), rewritten by every probe and every session.
-- ---------------------------------------------------------------------------
create table public.avatar_platform_state (
  avatar_id uuid not null references public.avatars(id) on delete cascade,
  platform text not null check (platform in ('twitter', 'tiktok', 'reddit', 'instagram')),
  on_device_status text not null default 'unknown' check (on_device_status in (
    'unknown', 'logged_in', 'logged_out', 'challenge', 'suspended', 'app_missing', 'app_outdated', 'unreadable'
  )),
  last_screen_state text,
  probed_at timestamptz,
  last_session_at timestamptz,
  last_login_at timestamptz,
  followers_seen integer,
  following_seen integer,
  notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (avatar_id, platform)
);

create trigger avatar_platform_state_updated_at
  before update on public.avatar_platform_state
  for each row execute function public.set_updated_at();

alter table public.avatar_platform_state enable row level security;

create policy account_users_read_avatar_platform_state on public.avatar_platform_state
  for select using (
    avatar_id in (
      select a.id from public.avatars a
      where a.account_id in (select account_id from public.profiles where id = auth.uid())
    )
  );
create policy admin_full_access_avatar_platform_state on public.avatar_platform_state
  for all using (public.is_admin());

-- ---------------------------------------------------------------------------
-- maintenance_tasks — the queue of the Maintain loop. Scheduled by the
-- planner (or by an operator, or by an attention "done" awaiting its probe),
-- claimed with a lease, journaled step by step (steps jsonb, proofs as paths).
-- ---------------------------------------------------------------------------
create table public.maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  avatar_id uuid not null references public.avatars(id) on delete cascade,
  device_id uuid references public.devices(id) on delete set null,
  platform text check (platform in ('twitter', 'tiktok', 'reddit', 'instagram')),
  kind text not null check (kind in (
    'probe', 'warmup', 'dismiss_dialogs', 'coherence', 'app_check', 'social_session', 'relogin'
  )),
  status text not null default 'scheduled' check (status in (
    'scheduled', 'running', 'done', 'failed', 'skipped', 'cancelled'
  )),
  priority integer not null default 100,
  scheduled_for timestamptz not null default now(),
  params jsonb not null default '{}'::jsonb,
  attempt integer not null default 0,
  created_by text not null default 'scheduler' check (created_by in ('scheduler', 'operator', 'attention_reprobe', 'system')),
  attention_item_id uuid references public.attention_items(id) on delete set null,
  worker_id text,
  claimed_at timestamptz,
  lease_until timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  outcome text,
  error_category text,
  error_message text,
  steps jsonb not null default '[]'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index maintenance_tasks_due on public.maintenance_tasks (status, scheduled_for, priority desc);
create index maintenance_tasks_avatar on public.maintenance_tasks (avatar_id, scheduled_for desc);
create index maintenance_tasks_device_running on public.maintenance_tasks (device_id) where status = 'running';
create index maintenance_tasks_account_recent on public.maintenance_tasks (account_id, created_at desc);

create trigger maintenance_tasks_updated_at
  before update on public.maintenance_tasks
  for each row execute function public.set_updated_at();

alter table public.maintenance_tasks enable row level security;

create policy account_users_read_maintenance_tasks on public.maintenance_tasks
  for select using (
    account_id in (select account_id from public.profiles where id = auth.uid())
  );
create policy admin_full_access_maintenance_tasks on public.maintenance_tasks
  for all using (public.is_admin());

-- Claim the most urgent due task with a lease. Skips rows other workers hold
-- (FOR UPDATE SKIP LOCKED). Service role only.
create or replace function public.claim_maintenance_task(p_worker text, p_lease_seconds integer)
returns setof public.maintenance_tasks
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update public.maintenance_tasks t
      set status = 'running',
          worker_id = p_worker,
          claimed_at = now(),
          lease_until = now() + make_interval(secs => p_lease_seconds),
          started_at = coalesce(t.started_at, now()),
          attempt = t.attempt + 1
    where t.id = (
      select c.id from public.maintenance_tasks c
      where c.status = 'scheduled' and c.scheduled_for <= now()
      order by c.priority desc, c.scheduled_for asc
      for update skip locked
      limit 1
    )
    returning t.*;
end;
$$;

-- Extend the lease of a task this worker holds (heartbeat between steps).
create or replace function public.heartbeat_maintenance_task(p_id uuid, p_worker text, p_lease_seconds integer)
returns boolean
language sql
security definer
set search_path = public
as $$
  with touched as (
    update public.maintenance_tasks
      set lease_until = now() + make_interval(secs => p_lease_seconds)
    where id = p_id and worker_id = p_worker and status = 'running'
    returning id
  )
  select exists (select 1 from touched);
$$;

revoke execute on function public.claim_maintenance_task(text, integer) from public, anon, authenticated;
revoke execute on function public.heartbeat_maintenance_task(uuid, text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- avatars — the maintenance switch, the maturation profile and day zero.
-- ---------------------------------------------------------------------------
alter table public.avatars
  add column if not exists maintenance_enabled boolean not null default false,
  add column if not exists maintenance_profile text not null default 'mature'
    check (maintenance_profile in ('new', 'mature')),
  add column if not exists maintenance_day_zero date;

-- ---------------------------------------------------------------------------
-- Briefs — the army's cluster objective, and the effective brief compiled per
-- avatar (persona + objectives, contradictions listed rather than hidden).
-- ---------------------------------------------------------------------------
create table public.army_briefs (
  army_id uuid primary key references public.armies(id) on delete cascade,
  objective text not null default '',
  cluster_keywords text[] not null default '{}',
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger army_briefs_updated_at
  before update on public.army_briefs
  for each row execute function public.set_updated_at();

alter table public.army_briefs enable row level security;

create policy account_users_read_army_briefs on public.army_briefs
  for select using (
    army_id in (
      select ar.id from public.armies ar
      where ar.account_id in (select account_id from public.profiles where id = auth.uid())
    )
  );
create policy admin_full_access_army_briefs on public.army_briefs
  for all using (public.is_admin());

create table public.avatar_briefs (
  avatar_id uuid primary key references public.avatars(id) on delete cascade,
  effective_brief text not null default '',
  contradictions jsonb not null default '[]'::jsonb,
  sources jsonb not null default '{}'::jsonb,
  compiled_at timestamptz,
  compiled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger avatar_briefs_updated_at
  before update on public.avatar_briefs
  for each row execute function public.set_updated_at();

alter table public.avatar_briefs enable row level security;

create policy account_users_read_avatar_briefs on public.avatar_briefs
  for select using (
    avatar_id in (
      select a.id from public.avatars a
      where a.account_id in (select account_id from public.profiles where id = auth.uid())
    )
  );
create policy admin_full_access_avatar_briefs on public.avatar_briefs
  for all using (public.is_admin());

-- ---------------------------------------------------------------------------
-- avatar_usage_sessions — the maintainer is a third actor on a device.
-- ---------------------------------------------------------------------------
alter table public.avatar_usage_sessions drop constraint if exists avatar_usage_sessions_actor_type_check;
alter table public.avatar_usage_sessions
  add constraint avatar_usage_sessions_actor_type_check
  check (actor_type in ('operator', 'automator', 'maintainer'));

-- ---------------------------------------------------------------------------
-- runtime_settings — the maintainer's budgets and hours (admin-editable).
-- ---------------------------------------------------------------------------
insert into public.runtime_settings (key, value) values
  ('maintenance.budgets', '{
    "new":    { "sessions_per_day": 1, "session_minutes": [3, 6],  "likes_per_day": 0, "follows_per_day": 0 },
    "mature": { "sessions_per_day": 2, "session_minutes": [5, 12], "likes_per_day": 6, "follows_per_day": 2 }
  }'::jsonb),
  ('maintenance.active_hours', '{ "start": 8, "end": 23 }'::jsonb),
  ('maintenance.lease_seconds', '900'::jsonb),
  ('maintenance.probe_every_hours', '24'::jsonb),
  ('maintenance.app_check_every_days', '7'::jsonb)
on conflict (key) do nothing;
