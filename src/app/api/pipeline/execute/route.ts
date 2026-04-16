import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executeJob, uploadProofScreenshot } from "@/lib/pipeline";
import { ensureContainerRunning, stopContainerIfIdle } from "@/lib/box-api";

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
  // 3. Resolve device → box and check slot capacity
  // -----------------------------------------------------------------------
  const { data: device } = await supabase
    .from("devices")
    .select("db_id, box_id")
    .eq("id", job.device_id)
    .single();

  const { data: box } = device
    ? await supabase
        .from("boxes")
        .select("tunnel_hostname, max_concurrent_containers")
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

  const maxSlots = box.max_concurrent_containers ?? 10;

  const { count: boxExecuting } = await supabase
    .from("campaign_jobs")
    .select("*", { count: "exact", head: true })
    .eq("box_id", device.box_id)
    .eq("status", "executing");

  if ((boxExecuting ?? 0) >= maxSlots) {
    console.log(`[Execute] Box ${device.box_id} at capacity (${boxExecuting}/${maxSlots})`);
    return NextResponse.json({ action: "idle", message: "Box at capacity" });
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
  // 5. Ensure container is running (start if stopped)
  // -----------------------------------------------------------------------
  const { running } = await ensureContainerRunning(tunnelHostname, device.db_id);

  if (!running) {
    await supabase
      .from("campaign_jobs")
      .update({ status: "failed", error_message: "Container start timeout", completed_at: new Date().toISOString() })
      .eq("id", job.id);
    await supabase.rpc("increment_campaign_counter", { p_campaign_id: job.campaign_id, p_counter: "total_responses_failed" });
    return NextResponse.json({ jobId: job.id, success: false, status: "failed", error: "Container start timeout" });
  }

  // -----------------------------------------------------------------------
  // 6. Execute ADB automation
  // -----------------------------------------------------------------------
  const result = await executeJob({
    tunnelHostname,
    dbId: device.db_id,
    platform: job.platform,
    postUrl: job.post_url,
    commentText: job.comment_text,
    jobId: job.id,
  });

  const now = new Date().toISOString();

  console.log(`[Execute] Job ${job.id} finished`, JSON.stringify({
    success: result.success,
    error: result.error,
    durationMs: result.durationMs,
    mode: result.mode,
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
  } else {
    await supabase
      .from("campaign_jobs")
      .update({ status: "failed", error_message: result.error, completed_at: now, duration_ms: result.durationMs, source_screenshot: sourceUrl, proof_screenshot: proofUrl })
      .eq("id", job.id);
    await supabase.rpc("increment_campaign_counter", { p_campaign_id: job.campaign_id, p_counter: "total_responses_failed" });
  }

  // -----------------------------------------------------------------------
  // 9. Stop container if no more jobs waiting for this device
  // -----------------------------------------------------------------------
  await stopContainerIfIdle(tunnelHostname, device.db_id, job.device_id, supabase);

  return NextResponse.json({
    jobId: job.id,
    success: result.success,
    status: result.success ? "done" : "failed",
    durationMs: result.durationMs,
    error: result.error,
  });
}
