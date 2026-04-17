import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runSweepCycle } from "@/lib/gorgone";

/**
 * POST /api/gorgone/sweep
 *
 * Reconciliation sweep — the safety net behind the webhook ingestion.
 * Called every ~60s by the long-running worker in `server.mjs` (the
 * same pattern used by `/api/pipeline/process` and `/api/pipeline/execute`).
 *
 * Idempotent: safe to call concurrently from multiple workers because
 * row insertion uses `UNIQUE (gorgone_id) DO NOTHING` and the cursor
 * advance uses `MAX (collected_at, id)` — no race window where data
 * could be lost or double-counted.
 *
 * Protected by `CRON_SECRET` so it can also be triggered externally if
 * the in-process worker is unavailable.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization");

  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const report = await runSweepCycle(createAdminClient());
    return NextResponse.json({
      ok: true,
      action: report.total_ingested === 0 ? "idle" : "swept",
      ...report,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        action: "error",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
