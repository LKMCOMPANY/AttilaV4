-- Off-device (TikHub) confirmation of a `done` job, independent of `status`.
--
-- The on-device gate can over-report success — acutely on Twitter, where "the
-- composer closed" doesn't prove the reply landed (a shadow-ban / silent drop
-- is identical on-device). A deferred pass (`/api/pipeline/verify`) re-reads
-- the target via TikHub and records the verdict here without ever touching
-- `status` (no re-post, so no double-post risk).
--   unchecked   — not verified yet, or TikHub couldn't confirm either way
--   confirmed   — our comment/reply was found on the target
--   unconfirmed — checked, absent (shadow-ban / silent drop) → amber in the UI
ALTER TABLE campaign_jobs
  ADD COLUMN IF NOT EXISTS verification text NOT NULL DEFAULT 'unchecked',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

ALTER TABLE campaign_jobs DROP CONSTRAINT IF EXISTS campaign_jobs_verification_check;
ALTER TABLE campaign_jobs ADD CONSTRAINT campaign_jobs_verification_check
  CHECK (verification IN ('unchecked', 'confirmed', 'unconfirmed'));

COMMENT ON COLUMN campaign_jobs.verification IS
  'Off-device (TikHub) confirmation of a done job: unchecked (not yet / could not verify), confirmed (found on target), unconfirmed (checked but absent = shadow-ban/silent-drop). Independent of status.';
COMMENT ON COLUMN campaign_jobs.verified_at IS
  'When the TikHub verification pass last recorded a terminal verdict (confirmed/unconfirmed).';
