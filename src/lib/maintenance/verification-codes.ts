import { createHmac, timingSafeEqual } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { SocialPlatform } from "@/types";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Verification codes e-mailed by the platforms to an avatar's mailbox. The
 * Cloudflare Email Worker (infra/email-worker) posts each one here, signed
 * with `EMAIL_WORKER_SECRET`; the relogin recipe waits for the one it needs
 * and consumes it. A code is a credential: server-only table, never logged.
 */

export interface InboundCode {
  recipient: string;
  sender: string | null;
  subject: string | null;
  code: string;
  receivedAt: string;
}

/** Sender domains → platform. Anything else is stored with a null platform. */
const SENDER_PLATFORMS: Array<[RegExp, SocialPlatform]> = [
  [/@(?:[a-z0-9-]+\.)*tiktok\.com$/i, "tiktok"],
  [/@(?:[a-z0-9-]+\.)*(?:x\.com|twitter\.com)$/i, "twitter"],
  [/@(?:[a-z0-9-]+\.)*reddit(?:mail)?\.com$/i, "reddit"],
  [/@(?:[a-z0-9-]+\.)*instagram\.com$/i, "instagram"],
];

export function platformFromSender(sender: string | null): SocialPlatform | null {
  if (!sender) return null;
  const match = SENDER_PLATFORMS.find(([re]) => re.test(sender.trim()));
  return match ? match[1] : null;
}

/** HMAC-SHA256 of the raw body, hex; constant-time compare. */
export function signatureIsValid(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const given = signature.trim().toLowerCase().replace(/^sha256=/, "");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}

export async function storeVerificationCode(supabase: AdminClient, inbound: InboundCode): Promise<string | null> {
  const { data, error } = await supabase
    .from("verification_codes")
    .insert({
      recipient: inbound.recipient.trim().toLowerCase(),
      sender: inbound.sender,
      platform: platformFromSender(inbound.sender),
      code: inbound.code,
      subject: inbound.subject?.slice(0, 200) ?? null,
      received_at: inbound.receivedAt,
    })
    .select("id")
    .single();
  if (error) {
    console.error(`[Codes] insert failed for ${inbound.recipient}: ${error.message}`);
    return null;
  }
  return data.id;
}

export interface AwaitCodeOptions {
  recipient: string;
  platform: SocialPlatform;
  /** Only codes received after this instant count (the click that triggered them). */
  since: Date;
  timeoutMs: number;
  pollMs?: number;
  taskId: string;
}

/**
 * Wait for a fresh, unconsumed code for this mailbox and platform, consume it
 * atomically (`consumed_at` set on the row we take) and return it. Null when
 * nothing arrives within the timeout.
 */
export async function awaitVerificationCode(supabase: AdminClient, opts: AwaitCodeOptions): Promise<string | null> {
  const deadline = Date.now() + opts.timeoutMs;
  const poll = opts.pollMs ?? 5_000;
  while (Date.now() < deadline) {
    const { data } = await supabase
      .from("verification_codes")
      .select("id, code")
      .eq("recipient", opts.recipient.trim().toLowerCase())
      .or(`platform.eq.${opts.platform},platform.is.null`)
      .is("consumed_at", null)
      .gte("received_at", opts.since.toISOString())
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      const { data: taken } = await supabase
        .from("verification_codes")
        .update({ consumed_at: new Date().toISOString(), consumed_by_task: opts.taskId })
        .eq("id", data.id)
        .is("consumed_at", null)
        .select("id");
      if (taken && taken.length > 0) return data.code;
    }
    await new Promise((r) => setTimeout(r, poll));
  }
  return null;
}

/** The first 4–8 digit run in a text, or null (the worker does this on the e-mail body). */
export function extractCode(text: string): string | null {
  const match = /(?<![\d-])(\d{4,8})(?![\d-])/.exec(text.replace(/[\u00a0\s]+/g, " "));
  return match ? match[1] : null;
}
