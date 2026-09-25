-- scripts/maintenance-task.ts inserts a row and then claims "the most urgent due
-- task", which on 25 September 2026 was twice NOT its own row (another task
-- held the device), and the script either aborted with nothing or would have
-- left a foreign row `running`. The claim gains an optional p_task_id: when
-- given, only that row is considered, under the same rules (scheduled, due,
-- device not already busy). The two-argument form keeps its exact behaviour.
-- Applied through the Supabase MCP on 2026-09-25 as version 20260925211148.

drop function if exists public.claim_maintenance_task(text, integer);

create or replace function public.claim_maintenance_task(p_worker text, p_lease_seconds integer, p_task_id uuid default null)
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
      where c.status = 'scheduled'
        and c.scheduled_for <= now()
        and (p_task_id is null or c.id = p_task_id)
        and (
          c.device_id is null
          or not exists (
            select 1 from public.maintenance_tasks r
            where r.device_id = c.device_id and r.status = 'running'
          )
        )
      order by c.priority desc, c.scheduled_for asc
      for update skip locked
      limit 1
    )
    returning t.*;
end;
$$;

revoke execute on function public.claim_maintenance_task(text, integer, uuid) from public, anon, authenticated;
