-- Boot diagnostics for a device, produced by scripts/audit-device-health.mjs.
-- A container reporting state='running' is NOT proof it is usable: on box-1,
-- 44 of 96 containers carried an ext4 error flag and a share of those still
-- stall on the Android boot animation after repair. Recording the verdict makes
-- the unusable devices queryable instead of only discoverable when a job fails.
alter table public.devices
  add column if not exists boot_health text
    check (boot_health in ('healthy', 'unstable', 'dead')),
  add column if not exists boot_ms integer,
  add column if not exists boot_checked_at timestamptz;

comment on column public.devices.boot_health is
  'Last observed boot outcome: healthy = reached sys.boot_completed=1 and stayed up; unstable = booted then the container died; dead = never reached boot_completed within the timeout. Observed by scripts/audit-device-health.mjs. NOT yet used to gate device selection - the pipeline selector is unchanged.';
comment on column public.devices.boot_ms is
  'Milliseconds from run() to sys.boot_completed=1 on the last healthy boot.';
comment on column public.devices.boot_checked_at is
  'When boot_health was last measured.';

-- Partial index: readers only ever ask for the unusable ones.
create index if not exists devices_boot_health_idx
  on public.devices (boot_health)
  where boot_health is distinct from 'healthy';
