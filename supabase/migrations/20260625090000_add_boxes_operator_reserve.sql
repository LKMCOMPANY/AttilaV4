-- Per-box operator reserve: slots kept free for human operators so the
-- automator never fully saturates a box during campaigns. The automator caps
-- at (max_concurrent_containers - operator_reserve); operators may use up to
-- max_concurrent_containers. See src/app/api/pipeline/execute/route.ts and
-- src/app/actions/device-control.ts.
alter table public.boxes
  add column if not exists operator_reserve integer not null default 1;

comment on column public.boxes.operator_reserve is
  'Slots reserved for operators on this box: the automator caps at (max_concurrent_containers - operator_reserve), leaving these for human use.';

-- Operational sizing (also applied to the live DB): boxes with 15GB RAM and
-- 4GB containers thrash past ~3 concurrent. box-3/box-4 are capped at 3.
update public.boxes
  set max_concurrent_containers = 3, operator_reserve = 1
  where tunnel_hostname in ('box-3.attila.army', 'box-4.attila.army');
