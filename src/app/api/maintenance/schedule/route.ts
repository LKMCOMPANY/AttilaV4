import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { planMaintenance } from "@/lib/maintenance/planner";
import { scheduleReprobes } from "@/lib/maintenance/reprobe";

/**
 * POST /api/maintenance/schedule
 *
 * The Schedule worker: plan today's tasks for every avatar with maintenance
 * on (the pure planner decides what and when, in the persona's local day),
 * and queue a probe for every attention item a human marked done — the probe
 * is what resolves or reopens it. Idempotent; runs every half hour.
 * Protected by CRON_SECRET.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const [plan, reprobes] = await Promise.all([planMaintenance(supabase), scheduleReprobes(supabase)]);
  const quiet = plan.planned === 0 && reprobes === 0;
  return NextResponse.json({ action: quiet ? "idle" : "planned", ...plan, reprobes });
}
