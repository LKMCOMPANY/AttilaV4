import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { webhookPayloadSchema, enqueueGorgoneJob } from "@/lib/gorgone";

/**
 * POST /api/gorgone/webhook
 *
 * Single entry point for Gorgone V4 push notifications. Triggered
 * synchronously by Postgres trigger `posts_after_insert_attila`
 * (via `pg_net.http_post`).
 *
 * Auth: shared secret in `X-Webhook-Secret`, compared via timing-safe
 * equality. The secret is mirrored from Attila's environment to
 * Gorgone's `attila_integration_config` table.
 *
 * Idempotence: ingestion goes through `enqueue_gorgone_job` RPC which
 * uses `ON CONFLICT (gorgone_post_id) DO NOTHING`. Same payload can be
 * delivered any number of times without producing duplicates — webhook
 * retries, webhook + sweep races, manual replays are all safe.
 *
 * The handler always returns 200 unless the secret check fails (401)
 * or the payload is malformed (400). Failures during enqueue are
 * captured and reported in the body but the status stays 200 so
 * `pg_net` doesn't retry-storm — the sweep reconciler picks up
 * anything we couldn't enqueue right away.
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const expected = process.env.GORGONE_WEBHOOK_SECRET;
  if (!expected) {
    console.error("[gorgone/webhook] GORGONE_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }

  const provided = req.headers.get("x-webhook-secret") ?? "";
  if (!safeEqual(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = webhookPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid payload",
        details: parsed.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`,
        ),
      },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const event = parsed.data;
  const startedAt = Date.now();

  try {
    const outcome = await enqueueGorgoneJob(supabase, event.data, "webhook");
    return NextResponse.json({
      ok: true,
      event: event.event,
      post_id: event.data.post_id,
      outcome,
      duration_ms: Date.now() - startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gorgone/webhook] enqueue failed", {
      event: event.event,
      post_id: event.data.post_id,
      error: message,
    });
    // 200 on purpose: the sweep reconciler will rescue this.
    return NextResponse.json({
      ok: false,
      event: event.event,
      post_id: event.data.post_id,
      outcome: { inserted: false, reason: "error", error: message },
      duration_ms: Date.now() - startedAt,
    });
  }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
