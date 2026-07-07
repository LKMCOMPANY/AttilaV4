-- Fix the admin Infrastructure device count: it must reflect ACTIVE devices,
-- not every row ever seen. `get_device_counts_by_box` used a bare `count(*)`,
-- so devices marked `removed` (e.g. the 47 ghosts reconciled on 2026-07-07 whose
-- db_id no longer exists on the box) were still counted — box-5 showed 143 while
-- only 100 devices actually exist. Exclude `removed` so the count is truthful.

create or replace function public.get_device_counts_by_box()
  returns table(box_id uuid, count bigint)
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select box_id, count(*)
  from public.devices
  where state <> 'removed'
  group by box_id;
$function$;

revoke execute on function public.get_device_counts_by_box() from public, anon;
grant execute on function public.get_device_counts_by_box() to authenticated;
