-- Phase 0 of the avatar-maintenance layer ("opérateur IA"): the data the shared
-- engine, the attention queue and the audit trail need. Additive only.
-- Writes go through the service role (server cores); clients only read.
-- Applied through the Supabase MCP on 2026-09-09 as version 20260909163649.

-- ---------------------------------------------------------------------------
-- attention_items — the single queue of things a human must do, at three scopes.
-- avatar_platform_blocks stays the Automator gate; an item may point at the
-- block it opened through block_id.
-- ---------------------------------------------------------------------------
create table public.attention_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  scope text not null check (scope in ('avatar_platform', 'device', 'box')),
  avatar_id uuid references public.avatars(id) on delete cascade,
  platform text check (platform in ('twitter', 'tiktok', 'reddit', 'instagram')),
  device_id uuid references public.devices(id) on delete cascade,
  box_id uuid references public.boxes(id) on delete cascade,
  reason text not null,
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  title text not null,
  detail text,
  evidence jsonb not null default '{}'::jsonb,
  source text not null check (source in ('maintainer', 'executor', 'health_worker', 'reconcile', 'operator')),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'done_pending_reprobe', 'resolved', 'reopened')),
  reopen_count integer not null default 0,
  block_id uuid references public.avatar_platform_blocks(id) on delete set null,
  reprobe_task_id uuid,
  opened_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  acknowledged_by uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  done_by uuid references public.profiles(id) on delete set null,
  done_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  target_key text generated always as (
    scope || ':' || coalesce(avatar_id::text, '') || ':' || coalesce(platform, '')
      || ':' || coalesce(device_id::text, '') || ':' || coalesce(box_id::text, '')
  ) stored,
  constraint attention_items_scope_target check (
    (scope = 'avatar_platform' and avatar_id is not null and platform is not null)
    or (scope = 'device' and device_id is not null)
    or (scope = 'box' and box_id is not null)
  )
);

-- One open item per (account, target, reason); a re-detection bumps last_seen_at.
create unique index attention_items_open_uniq
  on public.attention_items (account_id, target_key, reason)
  where resolved_at is null;
create index attention_items_account_open
  on public.attention_items (account_id, status, severity)
  where resolved_at is null;
create index attention_items_avatar on public.attention_items (avatar_id) where avatar_id is not null;
create index attention_items_device on public.attention_items (device_id) where device_id is not null;

create trigger attention_items_updated_at
  before update on public.attention_items
  for each row execute function public.set_updated_at();

alter table public.attention_items enable row level security;

create policy account_users_read_attention_items on public.attention_items
  for select using (
    account_id in (select account_id from public.profiles where id = auth.uid())
  );
create policy admin_full_access_attention_items on public.attention_items
  for all using (public.is_admin());

-- Priority is computed once, server-side, for both clients.
create view public.attention_queue_v
with (security_invoker = true) as
select
  i.*,
  (case i.severity when 'critical' then 300 when 'warning' then 200 else 100 end)
    + (case i.scope when 'box' then 50 when 'device' then 30 else 10 end)
    + least(extract(epoch from (now() - i.opened_at)) / 86400.0, 14)::integer * 5
    + i.reopen_count * 20 as priority
from public.attention_items i
where i.resolved_at is null;

-- ---------------------------------------------------------------------------
-- device_app_versions — what build of each app a device carries, read online
-- (Control API v2 package/list) or offline (packages.xml in the stopped image).
-- ---------------------------------------------------------------------------
create table public.device_app_versions (
  device_id uuid not null references public.devices(id) on delete cascade,
  package text not null,
  version_name text,
  version_code bigint,
  checked_at timestamptz not null default now(),
  source text not null check (source in ('online_v2', 'offline_packages_xml')),
  primary key (device_id, package)
);

alter table public.device_app_versions enable row level security;

-- Visible to whoever can see the device (devices' own RLS applies in the subquery).
create policy device_readers_read_app_versions on public.device_app_versions
  for select using (
    exists (select 1 from public.devices d where d.id = device_app_versions.device_id)
  );
create policy admin_full_access_device_app_versions on public.device_app_versions
  for all using (public.is_admin());

-- ---------------------------------------------------------------------------
-- app_ui_selectors — versioned UI selectors per app build. Reference data:
-- readable by every signed-in user, written by the service role.
-- ---------------------------------------------------------------------------
create table public.app_ui_selectors (
  id uuid primary key default gen_random_uuid(),
  package text not null,
  key text not null,
  version_min bigint,
  version_max bigint,
  locale text,
  selector jsonb not null,
  priority integer not null default 100,
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index app_ui_selectors_lookup on public.app_ui_selectors (package, key, priority);

create trigger app_ui_selectors_updated_at
  before update on public.app_ui_selectors
  for each row execute function public.set_updated_at();

alter table public.app_ui_selectors enable row level security;

create policy authenticated_read_app_ui_selectors on public.app_ui_selectors
  for select to authenticated using (true);
create policy admin_full_access_app_ui_selectors on public.app_ui_selectors
  for all using (public.is_admin());

-- ---------------------------------------------------------------------------
-- avatar_actions — the one ledger of what an avatar did on a platform, per
-- local day. The Automator writes its replies, the maintainer everything else;
-- daily caps are computed against it.
-- ---------------------------------------------------------------------------
create table public.avatar_actions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  avatar_id uuid not null references public.avatars(id) on delete cascade,
  platform text not null check (platform in ('twitter', 'tiktok', 'reddit', 'instagram')),
  action text not null check (action in (
    'like', 'follow', 'unfollow', 'comment', 'reply', 'post', 'repost', 'login', 'search', 'session', 'dm'
  )),
  actor text not null check (actor in ('automator', 'maintainer', 'operator')),
  occurred_at timestamptz not null default now(),
  local_date date not null,
  ref_kind text check (ref_kind in ('campaign_job', 'maintenance_task', 'manual')),
  ref_id uuid,
  target text,
  created_at timestamptz not null default now()
);

create index avatar_actions_daily on public.avatar_actions (avatar_id, platform, local_date);
create index avatar_actions_account_time on public.avatar_actions (account_id, occurred_at desc);
create unique index avatar_actions_ref_uniq
  on public.avatar_actions (ref_kind, ref_id, action)
  where ref_id is not null;

alter table public.avatar_actions enable row level security;

create policy account_users_read_avatar_actions on public.avatar_actions
  for select using (
    account_id in (select account_id from public.profiles where id = auth.uid())
  );
create policy admin_full_access_avatar_actions on public.avatar_actions
  for all using (public.is_admin());

-- History becomes ledger data from day one: every job that posted.
insert into public.avatar_actions
  (account_id, avatar_id, platform, action, actor, occurred_at, local_date, ref_kind, ref_id, target)
select
  j.account_id,
  j.avatar_id,
  j.platform,
  case j.platform when 'twitter' then 'reply' else 'comment' end,
  'automator',
  j.completed_at,
  (j.completed_at at time zone coalesce(d.timezone, 'UTC'))::date,
  'campaign_job',
  j.id,
  j.post_url
from public.campaign_jobs j
left join public.devices d on d.id = j.device_id
where j.status = 'done' and j.avatar_id is not null and j.completed_at is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- audit_log — who did what (cores, maintainer sessions, operator marks).
-- ARCHITECTURE.md listed it for months; it did not exist until now.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_type text not null check (actor_type in ('user', 'maintainer', 'automator', 'system')),
  actor_id uuid,
  account_id uuid references public.accounts(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  detail jsonb not null default '{}'::jsonb
);

create index audit_log_account_at on public.audit_log (account_id, at desc);
create index audit_log_at on public.audit_log (at desc);

alter table public.audit_log enable row level security;

create policy account_users_read_audit_log on public.audit_log
  for select using (
    account_id in (select account_id from public.profiles where id = auth.uid())
  );
create policy admin_full_access_audit_log on public.audit_log
  for all using (public.is_admin());

-- ---------------------------------------------------------------------------
-- runtime_settings — operating switches and budgets, admin-owned, readable by
-- every signed-in user so the clients can show the current mode.
-- ---------------------------------------------------------------------------
create table public.runtime_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.runtime_settings enable row level security;

create policy authenticated_read_runtime_settings on public.runtime_settings
  for select to authenticated using (true);
create policy admin_full_access_runtime_settings on public.runtime_settings
  for all using (public.is_admin());

insert into public.runtime_settings (key, value) values
  ('maintenance.mode', '"observe"'::jsonb),
  ('maintenance.global_enabled', 'false'::jsonb),
  ('tikhub.daily_call_budget', '1500'::jsonb),
  ('aleria.daily_budget_usd', '1.0'::jsonb),
  ('maintenance.proof_retention_days', '30'::jsonb),
  ('audit_log.retention_days', '90'::jsonb);

-- ---------------------------------------------------------------------------
-- devices.agent_line — which Control API v2 line the guest runs (1.1.1 / 1.1.3):
-- the two behave differently after gestures (tree freshness), measured 9/09.
-- ---------------------------------------------------------------------------
alter table public.devices
  add column if not exists agent_line text,
  add column if not exists agent_checked_at timestamptz;

-- ---------------------------------------------------------------------------
-- Private bucket for maintenance proofs (third-party content on screen):
-- served through signed URLs minted by the server, never public.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('maintenance-proofs', 'maintenance-proofs', false, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;
