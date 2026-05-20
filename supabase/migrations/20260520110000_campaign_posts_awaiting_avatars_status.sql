-- Add 'awaiting_avatars' to the campaign_posts.status CHECK list.
--
-- Bug context (2026-05-20): the pipeline's no-avatar branch in
-- `lib/pipeline/processor.ts` has been inserting campaign_posts with
-- status = 'awaiting_avatars' since V4 wiring. The status was used by
-- the UI's "Awaiting" tab and by the cleanup loop's expire-after-2h
-- logic. But the CHECK constraint never listed it, so every such
-- insert silently failed (Postgres rejected the row, the code did
-- not capture the error in this branch, and `markJob(processed)`
-- ran anyway — the ledger reported "processed" while no row was
-- written).
--
-- End-to-end audit on the UAE campaign found 65 jobs marked processed
-- with only 2 campaign_posts on disk; the missing 63 were the
-- awaiting_avatars rows the CHECK had eaten.
--
-- The companion code change (same commit) wraps the insert in an
-- error capture so a future regression cannot fail silently again.

alter table public.campaign_posts
  drop constraint if exists campaign_posts_status_check;

alter table public.campaign_posts
  add constraint campaign_posts_status_check
  check (
    status in (
      'pending',
      'processing',
      'awaiting_avatars',
      'responded',
      'filtered_out',
      'error'
    )
  );

comment on constraint campaign_posts_status_check on public.campaign_posts is
  'awaiting_avatars added 2026-05-20 — the pipeline''s no-avatar branch needs this status to surface posts the operator can retry once an army is wired in. See lib/pipeline/processor.ts.';
