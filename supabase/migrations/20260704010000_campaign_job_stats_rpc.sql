-- Aggregated live job breakdown for the automator stats panel.
--
-- Returns, in a single round trip (uses the (campaign_id, status) index):
--   by_platform_status — count per (platform, status)
--   verification       — count per verification verdict (done jobs only)
--   errors             — count per failure category (failed jobs only), the
--                        [category] prefix extracted from error_message
--
-- Read-only, called by the `getCampaignStats` server action (service role).
CREATE OR REPLACE FUNCTION public.campaign_job_stats(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH j AS (
    SELECT
      platform,
      status,
      verification,
      CASE WHEN status = 'failed'
        THEN COALESCE(substring(error_message FROM '^\[([a-z_]+)\]'), 'unknown')
        ELSE NULL END AS err_category
    FROM campaign_jobs
    WHERE campaign_id = p_campaign_id
  )
  SELECT jsonb_build_object(
    'by_platform_status', (
      SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      FROM (SELECT platform, status, count(*) AS n FROM j GROUP BY platform, status) x
    ),
    'verification', (
      SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      FROM (SELECT verification, count(*) AS n FROM j WHERE status = 'done' GROUP BY verification) x
    ),
    'errors', (
      SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      FROM (SELECT err_category AS category, count(*) AS n FROM j WHERE status = 'failed' GROUP BY err_category) x
    )
  );
$$;

COMMENT ON FUNCTION public.campaign_job_stats(uuid) IS
  'Aggregated live job breakdown for a campaign (by platform/status, verification of done jobs, failure categories). Backs the automator stats panel; uses the (campaign_id, status) index.';
