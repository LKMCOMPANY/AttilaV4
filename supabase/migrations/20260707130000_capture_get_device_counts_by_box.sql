-- Capture the pre-existing `get_device_counts_by_box` RPC in the repo.
--
-- This function already lives in the database (used by `getBoxes()` in
-- src/app/actions/boxes.ts) but had no migration, so the repo was not a faithful
-- source of truth for it (schema drift, DB ahead of repo). This is an idempotent
-- CREATE OR REPLACE of the exact live definition, plus tightened EXECUTE grants:
-- the box dashboard calls it as an authenticated admin, so `anon` never needs to
-- (addresses the "anon can execute SECURITY DEFINER function" advisor for this
-- one function without affecting the app).

create or replace function public.get_device_counts_by_box()
  returns table(box_id uuid, count bigint)
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select box_id, count(*) from public.devices group by box_id;
$function$;

revoke execute on function public.get_device_counts_by_box() from anon;
grant execute on function public.get_device_counts_by_box() to authenticated;
