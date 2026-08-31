-- Social app provisioning, measured offline by scripts/audit-device-packages.mjs.
-- A device without TikTok or X cannot run a single job: this was the true
-- production blocker (302 of 451 devices on 2026-08-31) and the source of the
-- `device_setup_required` job failures. Tracking it makes the gap queryable
-- instead of only discoverable when a job fails.
alter table public.devices
  add column if not exists tiktok_installed boolean,
  add column if not exists twitter_installed boolean,
  add column if not exists packages_checked_at timestamptz;

comment on column public.devices.tiktok_installed is
  'TikTok (com.zhiliaoapp.musically) present in /data/app. Measured offline via debugfs, no boot required.';
comment on column public.devices.twitter_installed is
  'X (com.twitter.android) present in /data/app. Measured offline via debugfs, no boot required.';
comment on column public.devices.packages_checked_at is
  'When the offline package audit last ran for this device.';

-- The automator only ever asks for the job-capable ones.
create index if not exists devices_job_capable_idx
  on public.devices (box_id)
  where adbkeyboard_installed and (tiktok_installed or twitter_installed);
