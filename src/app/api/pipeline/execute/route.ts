import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executeJob } from "@/lib/pipeline";

/**
 * POST /api/pipeline/execute
 *
 * Simulates the gateway for dev testing: claims and executes a single ready job.
 * In production, the gateway on each box handles this via Supabase polling.
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

  // Claim next ready job where scheduled_at has passed
  const { data: job, error: claimError } = await supabase
    .from("campaign_jobs")
    .select("*, campaign:campaigns(*)")
    .eq("status", "ready")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .single();

  if (claimError || !job) {
    return NextResponse.json({ action: "idle", message: "No ready jobs" });
  }

  // Mark as executing (status guard prevents double-claim race condition)
  const { data: claimed } = await supabase
    .from("campaign_jobs")
    .update({ status: "executing", started_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "ready")
    .select("id");

  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ action: "skipped", message: "Job already claimed" });
  }

  // Resolve device → box hostname
  const { data: device } = await supabase
    .from("devices")
    .select("db_id, box_id")
    .eq("id", job.device_id)
    .single();

  const { data: box } = device
    ? await supabase.from("boxes").select("tunnel_hostname").eq("id", device.box_id).single()
    : { data: null };

  if (!device || !box) {
    await supabase
      .from("campaign_jobs")
      .update({
        status: "failed",
        error_message: "Device or box not found",
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return NextResponse.json({ error: "Device or box not found" }, { status: 404 });
  }

  const tunnelHostname = box.tunnel_hostname;

  // Execute
  const result = await executeJob({
    tunnelHostname,
    dbId: device.db_id,
    platform: job.platform,
    postUrl: job.post_url,
    commentText: job.comment_text,
    jobId: job.id,
  });

  // Report result
  const now = new Date().toISOString();

  if (result.success) {
    await supabase
      .from("campaign_jobs")
      .update({
        status: "done",
        completed_at: now,
        duration_ms: result.durationMs,
      })
      .eq("id", job.id);

    await supabase.rpc("increment_campaign_counter", {
      p_campaign_id: job.campaign_id,
      p_counter: "total_responses_sent",
    });
  } else {
    await supabase
      .from("campaign_jobs")
      .update({
        status: "failed",
        error_message: result.error,
        completed_at: now,
        duration_ms: result.durationMs,
      })
      .eq("id", job.id);

    await supabase.rpc("increment_campaign_counter", {
      p_campaign_id: job.campaign_id,
      p_counter: "total_responses_failed",
    });
  }

  return NextResponse.json({
    jobId: job.id,
    success: result.success,
    status: result.success ? "done" : "failed",
    durationMs: result.durationMs,
    error: result.error,
  });
}
