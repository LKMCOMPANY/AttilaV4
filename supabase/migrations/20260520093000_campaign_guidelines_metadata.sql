-- ============================================================================
-- Attila V4 — Campaign guidelines AI generation metadata
-- ============================================================================
-- Two columns supporting the "Generate guidelines with AI" feature:
--
--   * `guidelines_generated_at` — null-safe timestamp of the last AI run
--     that produced the (operational_context, strategy, key_messages)
--     triple. Lets the UI surface a stale indicator ("generated 2h ago")
--     and lets the auto-update cron skip campaigns whose guidelines were
--     manually edited after the last AI write (human edit wins).
--
--   * `guidelines_auto_update` — opt-in boolean. When true, the daily
--     cron regenerates the three fields. When false (default), AI
--     generation only happens on explicit operator click. Keeps cost
--     predictable and preserves manual edits by default.
--
-- Both columns are additive and nullable / boolean-default-false: the
-- migration is safe to apply against the running prod with zero
-- backfill churn.
-- ============================================================================

alter table public.campaigns
  add column if not exists guidelines_generated_at timestamptz,
  add column if not exists guidelines_auto_update boolean not null default false;

-- Partial index — only the rows the cron actually scans. Excludes the
-- (large) tail of campaigns where auto-update is off, and orders by the
-- staleness key so the cron can `LIMIT 50 ORDER BY guidelines_generated_at`
-- to refresh the oldest first.
create index if not exists campaigns_auto_update_idx
  on public.campaigns (status, guidelines_generated_at nulls first)
  where guidelines_auto_update;

comment on column public.campaigns.guidelines_generated_at is
  'Timestamp of the last AI-driven write to (operational_context, strategy, key_messages). Null when the guidelines have never been AI-generated.';
comment on column public.campaigns.guidelines_auto_update is
  'Opt-in flag for the daily cron auto-regeneration. Default false.';
