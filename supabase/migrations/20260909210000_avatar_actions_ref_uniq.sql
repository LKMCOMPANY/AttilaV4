-- The ledger's idempotency index was partial (`where ref_id is not null`), and
-- PostgREST upserts cannot name a partial index: every `avatar_actions` write
-- of the Automator and the maintainer failed with "no unique or exclusion
-- constraint matching the ON CONFLICT specification" (measured 9/09/2026 on a
-- real session). A plain unique index gives the same guarantee — NULL ref_ids
-- are all distinct, so manual rows without a reference still coexist.
drop index if exists public.avatar_actions_ref_uniq;
create unique index avatar_actions_ref_uniq
  on public.avatar_actions (ref_kind, ref_id, action);
