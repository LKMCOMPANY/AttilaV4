-- Follow-up to 20260707130000 / 20260707140000: those revoked EXECUTE from
-- `anon`/`authenticated`, but several functions also carry a `PUBLIC` grant, so
-- anon/authenticated still inherited EXECUTE (advisors still fired). Revoke from
-- PUBLIC too. `service_role` keeps its own explicit grant, so the pipeline /
-- gorgone workers (admin client) are unaffected.
--
-- Deliberately NOT locked: is_admin() — it is called inside RLS policy
-- expressions, which evaluate as the querying role, so `authenticated`/`anon`
-- MUST retain EXECUTE or every admin RLS check breaks (lockout).

revoke execute on function public.claim_pending_post(text) from public, anon, authenticated;
revoke execute on function public.register_gorgone_event(uuid, uuid, text, text, timestamptz, uuid, text) from public, anon, authenticated;
revoke execute on function public.list_gorgone_zone_cursors_for_link(uuid) from public, anon, authenticated;
revoke execute on function public.increment_campaign_counter(uuid, text) from public, anon, authenticated;

-- handle_new_user() is an auth-signup TRIGGER: triggers fire as the table owner
-- regardless of EXECUTE grants, so revoking the RPC surface is safe.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- get_device_counts_by_box: called by the admin box dashboard as an authenticated
-- admin — revoke PUBLIC/anon, keep authenticated.
revoke execute on function public.get_device_counts_by_box() from public, anon;
grant execute on function public.get_device_counts_by_box() to authenticated;
