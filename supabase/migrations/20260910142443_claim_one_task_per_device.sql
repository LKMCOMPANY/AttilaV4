-- One maintenance task at a time per device. On 10 September 2026 the two
-- Maintain workers claimed a probe, an app_check and a coherence check of the
-- same device within two seconds: three sessions on one container, one of
-- them reading the v2 agent while another was booting it ("no route to
-- host"), and a false "app missing" item as a result. The claim now skips any
-- task whose device already carries a running one; the other worker takes the
-- next device or waits.
-- Applied through the Supabase MCP on 2026-09-10 as version 20260910142443.
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
      where c.status = 'scheduled'
        and c.scheduled_for <= now()
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

revoke execute on function public.claim_maintenance_task(text, integer) from public, anon, authenticated;
