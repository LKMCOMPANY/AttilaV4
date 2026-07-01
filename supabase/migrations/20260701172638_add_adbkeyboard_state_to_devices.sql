-- Track ADBKeyboard provisioning state per device so fleet coverage is
-- queryable without rebooting each container. Additive + nullable (null =
-- never checked) — non-breaking. Populated by scripts/install-adbkeyboard.mjs
-- and scripts/audit-adbkeyboard.mjs.
alter table public.devices
  add column if not exists adbkeyboard_installed boolean,
  add column if not exists adbkeyboard_enabled boolean,
  add column if not exists adbkeyboard_checked_at timestamptz;

comment on column public.devices.adbkeyboard_installed is 'ADBKeyboard APK (com.android.adbkeyboard) present on device; null = never checked';
comment on column public.devices.adbkeyboard_enabled is 'ADBKeyboard IME enabled/selectable on device; null = never checked';
comment on column public.devices.adbkeyboard_checked_at is 'Last time ADBKeyboard state was verified on the device';
