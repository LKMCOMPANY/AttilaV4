-- Security hardening (Supabase advisors 0028/0029): lock service-only
-- SECURITY DEFINER functions so they can't be executed by anonymous or
-- signed-in users via PostgREST `/rest/v1/rpc/*`.
--
-- All six are pipeline/gorgone internals invoked exclusively with the
-- service-role admin client (see src/lib/pipeline/processor.ts,
-- src/app/actions/pipeline.ts, src/lib/gorgone/ingest.ts). `service_role`
-- bypasses these grants, so revoking `anon` + `authenticated` changes nothing
-- for the app while closing the exposed RPC surface. NOT touched: is_admin()
-- (used inside RLS, must stay executable) and handle_new_user() (trigger).

revoke execute on function public.claim_pending_job(uuid[], text[]) from anon, authenticated;
revoke execute on function public.claim_pending_post(text) from anon, authenticated;
revoke execute on function public.enqueue_gorgone_job(uuid, timestamptz, uuid, uuid, text, text, timestamptz, bigint, text) from anon, authenticated;
revoke execute on function public.register_gorgone_event(uuid, uuid, text, text, timestamptz, uuid, text) from anon, authenticated;
revoke execute on function public.list_gorgone_zone_cursors_for_link(uuid) from anon, authenticated;
revoke execute on function public.increment_campaign_counter(uuid, text) from anon, authenticated;
