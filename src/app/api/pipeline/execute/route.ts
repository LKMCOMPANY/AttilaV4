import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { broadcastCampaignEvent, broadcastAccountEvent } from "@/lib/supabase/realtime";
import { executeJob, uploadProofScreenshot } from "@/lib/pipeline";
import {
  ensureContainerReady,
  stopContainerIfIdle,
  ContainerNotReadyError,
} from "@/lib/box-api";
import { encodeJobError, isAutoRetryable, JobError, parseJobError } from "@/lib/automation/errors";
import { tagAvatarBlocked } from "@/lib/pipeline/avatar-selector";

/**
 * Only account-level failures warrant tagging the avatar `blocked_${platform}`.
 * These are the categories where the avatar's session/account itself is the
 * problem and no future job can succeed until an operator acts.
 */
function shouldBlockAvatar(error: string | undefined): boolean {
  const parsed = parseJobError(error);
  if (!parsed) return false;
  return (
    parsed.category === "account_logged_out" ||
    parsed.category === "account_blocked" ||
    parsed.category === "account_captcha"
  );
}

/**
 * Auto-retry budget for pre-compose failures (`app_not_ready`: app never
 * foregrounded, video never loaded, comments panel never opened). Observed
 * live: the same video failed on one device and posted fine on another two
 * minutes later — these flakes are device-moment-specific, and a delayed
 * retry recovers most of them. 3 total attempts, spaced by a growing delay.
 */
const MAX_JOB_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 2 * 60 * 1000;

/**
 * An `executing` row this old is an orphan: the worker died mid-job (deploy
 * restart, crash, OOM) and nothing will ever complete it. Real executions
 * are bounded far below this by the automation modules' own timeouts.
 * Orphans are poison — they hold their device in `busyDeviceIds` forever and
 * shield its container from the reaper.
 */
const STALE_EXECUTING_MS = 15 * 60 * 1000;

async function failStaleExecutingJobs(supabase: ReturnType<typeof createAdminClient>) {
  const cutoff = new Date(Date.now() - STALE_EXECUTING_MS).toISOString();
  const { data } = await supabase
    .from("campaign_jobs")
    .update({
      status: "failed",
      error_message: "[infrastructure] Worker restarted mid-execution — outcome unverifiable",
      completed_at: new Date().toISOString(),
    })
    .eq("status", "executing")
    .lt("started_at", cutoff)
    .select("id, campaign_id");

  for (const job of data ?? []) {
    console.warn(`[Execute] Failed stale executing job ${job.id} (worker restart)`);
    await supabase.rpc("increment_campaign_counter", { p_campaign_id: job.campaign_id, p_counter: "total_responses_failed" });
    broadcastCampaignEvent(job.campaign_id, "pipeline", { action: "job_completed", status: "failed" });
  }
}

/**
 * POST /api/pipeline/execute
 *
 * Claims and executes a single ready job. Prevents device collisions by
 * excluding devices that already have an executing job. Manages container
 * lifecycle (start before, stop after if idle).
 *
 * Protected by CRON_SECRET.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // -----------------------------------------------------------------------
  // 0. Sweep orphaned `executing` jobs (worker died mid-run)
  // -----------------------------------------------------------------------
  await failStaleExecutingJobs(supabase);

  // -----------------------------------------------------------------------
  // 1. Find devices currently busy (executing) — exclude them from claim
  // -----------------------------------------------------------------------
  const { data: busyRows } = await supabase
    .from("campaign_jobs")
    .select("device_id")
    .eq("status", "executing");

  const busyDeviceIds = [...new Set((busyRows ?? []).map((r) => r.device_id))];

  // -----------------------------------------------------------------------
  // 2. Claim next ready job on an available device
  // -----------------------------------------------------------------------
  let query = supabase
    .from("campaign_jobs")
    .select("*, campaign:campaigns(*)")
    .eq("status", "ready")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(1);

  if (busyDeviceIds.length > 0) {
    query = query.not("device_id", "in", `(${busyDeviceIds.join(",")})`);
  }

  const { data: job, error: claimError } = await query.single();

  if (claimError || !job) {
    return NextResponse.json({ action: "idle", message: "No ready jobs" });
  }

  // -----------------------------------------------------------------------
  // 3. Resolve device → box and check capacity.
  //    The cap is the box's max_concurrent_containers MINUS the operator
  //    reserve, counted against the REAL running containers (the same pool the
  //    operator dashboard uses). Leaving `operator_reserve` slots free means a
  //    human can always open a device even while campaigns run. Executing a job
  //    on an already-running device is never gated — it adds no new container.
  // -----------------------------------------------------------------------
  const { data: device } = await supabase
    .from("devices")
    .select("db_id, box_id, state")
    .eq("id", job.device_id)
    .single();

  const { data: box } = device
    ? await supabase
        .from("boxes")
        .select("tunnel_hostname, max_concurrent_containers, operator_reserve")
        .eq("id", device.box_id)
        .single()
    : { data: null };

  if (!device || !box) {
    console.error(`[Execute] Job ${job.id} — device or box not found`, { deviceId: job.device_id });
    await supabase
      .from("campaign_jobs")
      .update({ status: "failed", error_message: "Device or box not found", completed_at: new Date().toISOString() })
      .eq("id", job.id);
    return NextResponse.json({ error: "Device or box not found" }, { status: 404 });
  }

  if (device.state !== "running") {
    const automatorSlots =
      (box.max_concurrent_containers ?? 3) - (box.operator_reserve ?? 1);

    const { count: boxRunning } = await supabase
      .from("devices")
      .select("*", { count: "exact", head: true })
      .eq("box_id", device.box_id)
      .eq("state", "running");

    if ((boxRunning ?? 0) >= automatorSlots) {
      console.log(`[Execute] Box ${device.box_id} at capacity (${boxRunning}/${automatorSlots} automator slots)`);
      return NextResponse.json({ action: "idle", message: "Box at capacity" });
    }
  }

  // -----------------------------------------------------------------------
  // 4. Mark as executing (status guard prevents double-claim)
  // -----------------------------------------------------------------------
  const { data: claimed } = await supabase
    .from("campaign_jobs")
    .update({ status: "executing", started_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "ready")
    .select("id");

  if (!claimed || claimed.length === 0) {
    console.log(`[Execute] Job ${job.id} already claimed by another worker`);
    return NextResponse.json({ action: "skipped", message: "Job already claimed" });
  }

  const tunnelHostname = box.tunnel_hostname;
  console.log(`[Execute] Claimed job ${job.id}`, JSON.stringify({
    campaignId: job.campaign_id,
    platform: job.platform,
    deviceId: job.device_id,
    dbId: device.db_id,
    tunnelHostname,
    commentPreview: job.comment_text?.slice(0, 60),
  }));

  // -----------------------------------------------------------------------
  // 5. Ensure container is running AND Android has finished booting
  // -----------------------------------------------------------------------
  try {
    const { wasStarted } = await ensureContainerReady(tunnelHostname, device.db_id);
    if (wasStarted) {
      await supabase
        .from("devices")
        .update({ state: "running", last_seen: new Date().toISOString() })
        .eq("id", job.device_id);
      broadcastAccountEvent(job.account_id, "devices", { action: "state_changed" });
    }
  } catch (err) {
    // Container failed to come up. Map to typed error so the dashboard
    // shows it as transient infra rather than an unknown bug.
    const wrapped = err instanceof ContainerNotReadyError
      ? err
      : new JobError(
          "infrastructure",
          err instanceof Error ? err.message : "Container readiness failed",
        );
    const error = encodeJobError(wrapped);
    await supabase
      .from("campaign_jobs")
      .update({ status: "failed", error_message: error, completed_at: new Date().toISOString() })
      .eq("id", job.id);
    await supabase.rpc("increment_campaign_counter", { p_campaign_id: job.campaign_id, p_counter: "total_responses_failed" });
    broadcastCampaignEvent(job.campaign_id, "pipeline", { action: "job_completed", status: "failed" });
    broadcastCampaignEvent(job.campaign_id, "counters", { action: "failed" });
    broadcastAccountEvent(job.account_id, "jobs", { action: "job_completed" });
    return NextResponse.json({ jobId: job.id, success: false, status: "failed", error });
  }

  // -----------------------------------------------------------------------
  // 6. Execute ADB automation. `executeJob` captures + restores the IME.
  //    `ContainerNotReadyError` may bubble if the device dies mid-flow.
  // -----------------------------------------------------------------------
  let result;
  try {
    result = await executeJob({
      tunnelHostname,
      dbId: device.db_id,
      platform: job.platform,
      postUrl: job.post_url,
      commentText: job.comment_text,
      jobId: job.id,
    });
  } catch (err) {
    console.error(`[Execute] Job ${job.id} crashed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    result = {
      success: false,
      error: encodeJobError(err),
      durationMs: 0,
    };
  }

  const now = new Date().toISOString();

  console.log(`[Execute] Job ${job.id} finished`, JSON.stringify({
    success: result.success,
    error: result.error,
    durationMs: result.durationMs,
  }));

  // -----------------------------------------------------------------------
  // 7. Upload screenshots
  // -----------------------------------------------------------------------
  const [sourceUrl, proofUrl] = await Promise.all([
    uploadProofScreenshot(result.sourceScreenshot, job.campaign_id, job.id, "source"),
    uploadProofScreenshot(result.proofScreenshot, job.campaign_id, job.id, "proof"),
  ]);

  // -----------------------------------------------------------------------
  // 8. Report result to DB
  // -----------------------------------------------------------------------
  if (result.success) {
    await supabase
      .from("campaign_jobs")
      .update({ status: "done", completed_at: now, duration_ms: result.durationMs, source_screenshot: sourceUrl, proof_screenshot: proofUrl })
      .eq("id", job.id);
    await supabase.rpc("increment_campaign_counter", { p_campaign_id: job.campaign_id, p_counter: "total_responses_sent" });

    // The independent TikHub confirmation is NOT done here: the platform needs
    // time to index a fresh post, and blocking the worker (and the container
    // teardown) on a 15s scrape per job would wreck throughput. A separate
    // deferred pass (`/api/pipeline/verify`) re-reads the target once it's had
    // time to index and sets `verification` (confirmed / unconfirmed).
  } else {
    // Pre-compose failures (nothing typed, nothing sent — guaranteed by the
    // `app_not_ready` contract) are re-queued with backoff instead of failed:
    // they are device-moment flakes and a later attempt usually lands. The
    // failure counter is only touched when the job goes terminal.
    const attempts = (job.attempts ?? 0) + 1;
    const parsed = parseJobError(result.error);
    if (parsed && isAutoRetryable(parsed.category) && attempts < MAX_JOB_ATTEMPTS) {
      await supabase
        .from("campaign_jobs")
        .update({
          status: "ready",
          attempts,
          started_at: null,
          scheduled_at: new Date(Date.now() + RETRY_BACKOFF_MS * attempts).toISOString(),
          error_message: `retry ${attempts}/${MAX_JOB_ATTEMPTS - 1} scheduled: ${result.error}`,
          source_screenshot: sourceUrl,
          proof_screenshot: proofUrl,
        })
        .eq("id", job.id);
      console.log(`[Execute] Job ${job.id} re-queued (attempt ${attempts}/${MAX_JOB_ATTEMPTS - 1})`, { error: result.error });
      broadcastCampaignEvent(job.campaign_id, "pipeline", { action: "job_retry", attempts });
      broadcastAccountEvent(job.account_id, "jobs", { action: "job_retry" });
      await stopContainerIfIdle(tunnelHostname, device.db_id, job.device_id, supabase);
      return NextResponse.json({ jobId: job.id, success: false, status: "retry_scheduled", attempts, error: result.error });
    }

    await supabase
      .from("campaign_jobs")
      .update({ status: "failed", attempts, error_message: result.error, completed_at: now, duration_ms: result.durationMs, source_screenshot: sourceUrl, proof_screenshot: proofUrl })
      .eq("id", job.id);
    await supabase.rpc("increment_campaign_counter", { p_campaign_id: job.campaign_id, p_counter: "total_responses_failed" });

    // Account-level failures (logged out, suspended, captcha) mean this avatar
    // can't work on this platform until an operator intervenes — tag it so the
    // selector stops routing jobs to it. Transient/infra/content failures do
    // not tag (they'd churn the whole army on a bad box or a deleted post).
    if (shouldBlockAvatar(result.error) && job.avatar_id) {
      await tagAvatarBlocked(supabase, job.avatar_id, job.platform);
    }
  }

  broadcastCampaignEvent(job.campaign_id, "pipeline", {
    action: "job_completed",
    status: result.success ? "done" : "failed",
  });
  broadcastCampaignEvent(job.campaign_id, "counters", {
    action: result.success ? "sent" : "failed",
  });
  broadcastAccountEvent(job.account_id, "jobs", { action: "job_completed" });

  // -----------------------------------------------------------------------
  // 9. Stop container if no more jobs waiting for this device
  // -----------------------------------------------------------------------
  await stopContainerIfIdle(tunnelHostname, device.db_id, job.device_id, supabase);
  broadcastAccountEvent(job.account_id, "devices", { action: "state_changed" });

  return NextResponse.json({
    jobId: job.id,
    success: result.success,
    status: result.success ? "done" : "failed",
    durationMs: result.durationMs,
    error: result.error,
  });
}
