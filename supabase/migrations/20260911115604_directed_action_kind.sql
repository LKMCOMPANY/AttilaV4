-- A human-directed action (like, follow, comment on one target, ordered from a
-- cockpit — the macOS MCP server first) is a maintenance task like the others:
-- same claim, same lease, same journal, same engine, same ledger. Only its
-- origin differs (created_by = 'operator', params.request_id groups an army
-- fan-out). The kind check learns the new kind; nothing else changes.
-- Applied through the Supabase MCP on 2026-09-11 as version 20260911115604.
alter table public.maintenance_tasks
  drop constraint if exists maintenance_tasks_kind_check;
alter table public.maintenance_tasks
  add constraint maintenance_tasks_kind_check
  check (kind = any (array['probe'::text, 'warmup'::text, 'dismiss_dialogs'::text, 'coherence'::text, 'app_check'::text, 'social_session'::text, 'relogin'::text, 'directed_action'::text]));

-- The fan-out status reads the tasks of one request; the params key is the
-- natural filter, indexed so an account's queue stays cheap to scan.
create index if not exists maintenance_tasks_request_id_idx
  on public.maintenance_tasks ((params->>'request_id'))
  where kind = 'directed_action';
