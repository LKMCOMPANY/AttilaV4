-- Client UPDATE policy on `devices`.
--
-- Root cause fixed: `devices` only had `admin_all_devices` (ALL, admin) and
-- `client_read_assigned_devices` (SELECT). Non-admin operators/managers had NO
-- UPDATE path, so operator server actions that use the *user-scoped* client
-- (proxy set/clear/verify, container start/stop → state) succeeded on the box
-- but updated 0 rows in Postgres SILENTLY (RLS returns no error, just no match).
-- The operator UI then reloaded the stale DB value and it looked like "proxy
-- editing doesn't work". This adds the missing UPDATE policy, scoped to exactly
-- the rows a client can already SEE (mirrors `client_read_assigned_devices`):
-- the device is directly assigned to their account OR sits on a box shared via
-- `account_boxes`.
--
-- WITH CHECK repeats the same predicate so a client cannot reassign a device to
-- an account/box they do not own (the post-update row must still satisfy the
-- ownership union). Column-level restriction is intentionally NOT done via GRANT
-- REVOKE here: admin device sync (`syncBoxDevices`) writes many columns through
-- the same `authenticated` role, and a column GRANT revoke would break it. Row
-- ownership + WITH CHECK is the correct guard; the write surface is limited to a
-- client's own devices and is reconciled by sync.

create policy client_update_assigned_devices
  on public.devices
  for update
  to authenticated
  using (
    (exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.account_id = devices.account_id
    ))
    or (exists (
      select 1
      from public.account_boxes ab
      join public.profiles p on p.account_id = ab.account_id
      where ab.box_id = devices.box_id
        and p.id = auth.uid()
    ))
  )
  with check (
    (exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.account_id = devices.account_id
    ))
    or (exists (
      select 1
      from public.account_boxes ab
      join public.profiles p on p.account_id = ab.account_id
      where ab.box_id = devices.box_id
        and p.id = auth.uid()
    ))
  );
