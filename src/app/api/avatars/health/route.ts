import { NextRequest, NextResponse } from "next/server";
import { refreshAccountHealth } from "@/lib/social-verify/account-health";

/**
 * POST /api/avatars/health
 *
 * Off-device account-health pass: probes a small batch of stale avatar
 * accounts via TikHub and records each as active / suspended / notfound in
 * `avatar_platform_health`. Purely informational — never tags or blocks an
 * avatar. Driven by a slow worker loop in server.mjs.
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
    const result = await refreshAccountHealth();
    if (result.checked === 0) {
      return NextResponse.json({ action: "idle", ...result });
    }
    return NextResponse.json({ action: "checked", ...result });
  } catch (err) {
    console.error("[AccountHealth] Unhandled error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
