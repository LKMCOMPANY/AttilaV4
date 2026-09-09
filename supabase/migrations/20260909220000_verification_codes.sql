-- Phase 2 of the avatar-maintenance layer: the codes the platforms e-mail to
-- an avatar's mailbox, delivered by the Cloudflare Email Worker
-- (infra/email-worker) to /api/maintenance/verification-codes. The relogin
-- recipe consumes them; nothing else reads the mailbox.
create table public.verification_codes (
  id uuid primary key default gen_random_uuid(),
  recipient text not null,
  sender text,
  platform text check (platform in ('twitter', 'tiktok', 'reddit', 'instagram')),
  code text not null,
  subject text,
  received_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_by_task uuid references public.maintenance_tasks(id) on delete set null,
  created_at timestamptz not null default now()
);

create index verification_codes_recipient_recent
  on public.verification_codes (lower(recipient), received_at desc)
  where consumed_at is null;

-- Server-only: the service role writes (webhook) and reads (recipes). No
-- client policy on purpose — a code is a credential.
alter table public.verification_codes enable row level security;
create policy admin_full_access_verification_codes on public.verification_codes
  for all using (public.is_admin());

-- Relogin attempts are rate-limited to one per account per day; the cooldown
-- is read from maintenance_tasks, this setting names it.
insert into public.runtime_settings (key, value) values
  ('maintenance.relogin_cooldown_hours', '24'::jsonb),
  ('maintenance.vision_agent_enabled', 'false'::jsonb)
on conflict (key) do nothing;
