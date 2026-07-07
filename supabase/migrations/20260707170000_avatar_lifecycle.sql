-- Avatar lifecycle: soft-archive + one-device-per-active-avatar guarantee.
--
-- `archived_at` implements a reversible soft-delete: an archived avatar keeps
-- its history/credentials but is detached from its device and hidden from the
-- active operator list. Kept as a nullable timestamp (null = active) rather than
-- overloading the `status` text so status semantics (active/inactive/suspended)
-- stay intact and archiving is trivially reversible.
--
-- The partial unique index enforces that a device is attached to AT MOST ONE
-- active avatar (archived avatars are excluded, so archiving frees the device
-- for immediate re-attach). This is the DB safety net behind setAvatarDevice's
-- app-level check. No existing duplicates (verified before applying).

alter table public.avatars add column if not exists archived_at timestamptz;

create unique index if not exists avatars_active_device_uniq
  on public.avatars (device_id)
  where device_id is not null and archived_at is null;
