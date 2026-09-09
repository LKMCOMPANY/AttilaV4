import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { signatureIsValid, storeVerificationCode } from "@/lib/maintenance/verification-codes";

/**
 * POST /api/maintenance/verification-codes
 *
 * Inbound from the Cloudflare Email Worker (infra/email-worker): one platform
 * e-mail, already reduced to its code. Authenticated by an HMAC-SHA256 of the
 * raw body with `EMAIL_WORKER_SECRET` (`X-Attila-Signature`). The body is
 * never logged: a code is a credential.
 */
const inboundSchema = z.object({
  recipient: z.string().email(),
  sender: z.string().max(320).nullable().optional(),
  subject: z.string().max(500).nullable().optional(),
  code: z.string().regex(/^\d{4,8}$/),
  receivedAt: z.string().datetime().optional(),
});

export async function POST(req: NextRequest) {
  const secret = process.env.EMAIL_WORKER_SECRET;
  if (!secret) return NextResponse.json({ error: "Email worker not configured" }, { status: 503 });

  const raw = await req.text();
  if (!signatureIsValid(raw, req.headers.get("x-attila-signature"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = inboundSchema.safeParse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const id = await storeVerificationCode(createAdminClient(), {
    recipient: parsed.data.recipient,
    sender: parsed.data.sender ?? null,
    subject: parsed.data.subject ?? null,
    code: parsed.data.code,
    receivedAt: parsed.data.receivedAt ?? new Date().toISOString(),
  });
  if (!id) return NextResponse.json({ error: "Store failed" }, { status: 500 });
  return NextResponse.json({ ok: true, id });
}
