-- Auto-retry budget for pre-compose automation failures.
--
-- When the executor hits an `app_not_ready` failure (TikTok never
-- foregrounded, video never loaded, comments panel never opened — all
-- guaranteed BEFORE any text is typed), it re-queues the job instead of
-- failing it. `attempts` bounds that loop (MAX_JOB_ATTEMPTS in the execute
-- route) so a permanently-broken target can't retry forever.
ALTER TABLE campaign_jobs
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN campaign_jobs.attempts IS
  'Execution attempts consumed. Incremented when the executor re-queues a pre-compose failure (app_not_ready); bounded by MAX_JOB_ATTEMPTS in the execute route.';
