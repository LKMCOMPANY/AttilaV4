-- Phase 3 of the avatar-maintenance layer: the accounts an avatar should sit
-- next to (its cluster), discovered from the armies' keywords through TikHub
-- search, followed or liked by the maintainer within the daily budgets, and
-- remembered so the same creator is never proposed twice.
create table public.cluster_candidates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  avatar_id uuid not null references public.avatars(id) on delete cascade,
  platform text not null check (platform in ('twitter', 'tiktok', 'reddit', 'instagram')),
  kind text not null default 'creator' check (kind in ('creator', 'post', 'hashtag')),
  handle text not null,
  display_name text,
  followers integer,
  keyword text,
  source text not null check (source in ('tikhub_search', 'gorgone', 'manual')),
  score numeric not null default 0,
  status text not null default 'candidate' check (status in ('candidate', 'followed', 'skipped', 'rejected', 'failed')),
  discovered_at timestamptz not null default now(),
  acted_at timestamptz,
  task_id uuid references public.maintenance_tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (avatar_id, platform, kind, handle)
);

create index cluster_candidates_avatar_status on public.cluster_candidates (avatar_id, platform, status, score desc);

create trigger cluster_candidates_updated_at
  before update on public.cluster_candidates
  for each row execute function public.set_updated_at();

alter table public.cluster_candidates enable row level security;

create policy account_users_read_cluster_candidates on public.cluster_candidates
  for select using (
    account_id in (select account_id from public.profiles where id = auth.uid())
  );
create policy admin_full_access_cluster_candidates on public.cluster_candidates
  for all using (public.is_admin());

insert into public.runtime_settings (key, value) values
  ('maintenance.discovery_searches_per_day', '3'::jsonb),
  ('maintenance.like_probability', '0.15'::jsonb)
on conflict (key) do nothing;
