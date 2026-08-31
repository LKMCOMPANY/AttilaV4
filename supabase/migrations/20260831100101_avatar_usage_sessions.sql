-- Avatar usage sessions: one row per stretch of avatar occupation.
-- Operator rows are written live by the macOS app (insert on open,
-- heartbeat on last_seen_at, close on ended_at — a crashed client
-- leaves ended_at null and readers fall back to last_seen_at).
-- Automator rows are recorded by a trigger whenever a campaign job
-- carries device timing, so the pipeline needs no code change.

create table public.avatar_usage_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  avatar_id uuid not null references public.avatars(id) on delete cascade,
  actor_type text not null check (actor_type in ('operator', 'automator')),
  operator_id uuid references public.profiles(id) on delete set null,
  job_id uuid unique references public.campaign_jobs(id) on delete set null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint operator_sessions_have_operator
    check (actor_type <> 'operator' or operator_id is not null)
);

create index avatar_usage_sessions_avatar_started_idx
  on public.avatar_usage_sessions (avatar_id, started_at desc);
create index avatar_usage_sessions_account_started_idx
  on public.avatar_usage_sessions (account_id, started_at desc);

alter table public.avatar_usage_sessions enable row level security;

create policy account_users_read_usage on public.avatar_usage_sessions
  for select using (
    account_id in (select account_id from public.profiles where id = auth.uid())
  );

create policy members_insert_operator_usage on public.avatar_usage_sessions
  for insert with check (
    actor_type = 'operator'
    and operator_id = auth.uid()
    and account_id in (select account_id from public.profiles where id = auth.uid())
  );

create policy members_update_own_usage on public.avatar_usage_sessions
  for update using (operator_id = auth.uid()) with check (operator_id = auth.uid());

create policy admin_full_access_usage on public.avatar_usage_sessions
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'::user_role)
  );

-- Automator recording: any job that actually ran on a device
-- (started + completed, done OR failed) is one usage session.
create or replace function public.record_automator_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.avatar_id is null or new.started_at is null or new.completed_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.completed_at is not distinct from new.completed_at then
    return new;
  end if;
  insert into public.avatar_usage_sessions
    (account_id, avatar_id, actor_type, job_id, started_at, last_seen_at, ended_at)
  values
    (new.account_id, new.avatar_id, 'automator', new.id, new.started_at, new.completed_at, new.completed_at)
  on conflict (job_id) do nothing;
  return new;
end;
$$;

create trigger campaign_jobs_record_usage
  after insert or update on public.campaign_jobs
  for each row execute function public.record_automator_usage();

-- Backfill: history becomes usage data from day one.
insert into public.avatar_usage_sessions
  (account_id, avatar_id, actor_type, job_id, started_at, last_seen_at, ended_at)
select account_id, avatar_id, 'automator', id, started_at, completed_at, completed_at
from public.campaign_jobs
where avatar_id is not null and started_at is not null and completed_at is not null
on conflict (job_id) do nothing;
