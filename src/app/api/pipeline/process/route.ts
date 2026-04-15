import { NextRequest, NextResponse } from "next/server";
import { processNext } from "@/lib/pipeline";

/**
 * POST /api/pipeline/process
 *
 * Processes the next pending post through the automation pipeline.
 * Option A (dev): called manually or by a cron every 30-60s.
 * Option B (prod): replaced by a long-running worker on Render.
 *
 * Protected by CRON_SECRET — no user session required.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processNext();

    if (!result) {
      return NextResponse.json({ action: "idle", message: "No pending posts" });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[Pipeline] Unhandled error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
