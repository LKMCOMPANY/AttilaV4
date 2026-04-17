import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  webhookPayloadSchema,
  ingestTweet,
  ingestTiktok,
} from "@/lib/gorgone";

/**
 * POST /api/gorgone/webhook
 *
 * Single entry point for Gorgone push notifications. Triggered
 * synchronously by Postgres triggers on Gorgone's `twitter_tweets`
 * and `tiktok_videos` tables (via `pg_net.http_post`).
 *
 * Auth: shared secret in `X-Webhook-Secret`, compared via timing-safe
 * equality. The secret is mirrored from Attila's environment to
 * Gorgone's `integration_config` table — see `admin-config.ts`.
 *
 * Idempotency: ingestion functions use `UNIQUE (gorgone_id)` +
 * `ON CONFLICT DO NOTHING`, so the same payload can be delivered any
 * number of times without producing duplicates.
 *
 * The handler always returns 200 unless the secret check fails (401)
 * or the payload is malformed (400). Failures during ingestion are
 * captured and reported in the response body but the status stays
 * 200 to avoid `pg_net` retry storms — the sweep reconciler picks
 * up anything we couldn't process.
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // -------------------------------------------------------------------------
  // 1. Authentication — timing-safe shared secret
  // -------------------------------------------------------------------------
  const expected = process.env.GORGONE_WEBHOOK_SECRET;
  if (!expected) {
    console.error("[gorgone/webhook] GORGONE_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }

  const provided = req.headers.get("x-webhook-secret") ?? "";
  if (!safeEqual(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // -------------------------------------------------------------------------
  // 2. Parse + validate payload
  // -------------------------------------------------------------------------
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
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  // -------------------------------------------------------------------------
  // 3. Ingest — idempotent upsert + cursor advance
  // -------------------------------------------------------------------------
  const supabase = createAdminClient();
  const event = parsed.data;
  const startedAt = Date.now();

  try {
    const outcome =
      event.event === "tweet.created"
        ? await ingestTweet(supabase, event.data, "webhook")
        : await ingestTiktok(supabase, event.data, "webhook");

    return NextResponse.json({
      ok: true,
      event: event.event,
      gorgone_id: event.data.gorgone_id,
      outcome,
      duration_ms: Date.now() - startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gorgone/webhook] ingest failed", {
      event: event.event,
      gorgone_id: event.data.gorgone_id,
      error: message,
    });
    // 200 on purpose: sweep will catch up. We surface the error in the body
    // for observability via Gorgone's `net._http_response` log.
    return NextResponse.json({
      ok: false,
      event: event.event,
      gorgone_id: event.data.gorgone_id,
      outcome: { inserted: false, reason: "error", error: message },
      duration_ms: Date.now() - startedAt,
    });
  }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
