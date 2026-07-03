import { NextRequest, NextResponse } from "next/server";
import { verifyDoneJobs } from "@/lib/pipeline";

/**
 * POST /api/pipeline/verify
 *
 * Deferred off-device verification pass: re-reads recently-`done` jobs from
 * TikHub and records an independent `confirmed` / `unconfirmed` verdict (never
 * touches `status`, so no re-posting / double-post risk). Driven by a slow
 * worker loop in server.mjs.
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
    const result = await verifyDoneJobs();
    if (result.checked === 0) {
      return NextResponse.json({ action: "idle", ...result });
    }
    return NextResponse.json({ action: "verified", ...result });
  } catch (err) {
    console.error("[Verify] Unhandled error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
