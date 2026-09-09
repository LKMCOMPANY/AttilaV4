/**
 * Attila Email Worker — Cloudflare Email Routing → verification codes.
 *
 * Bind this worker as the catch-all destination of every domain the avatars'
 * mailboxes live on (Cloudflare dashboard → Email → Email Routing → Routes).
 * For each inbound message it extracts the first 4–8 digit code from the
 * subject or the body and POSTs `{ recipient, sender, subject, code,
 * receivedAt }` to the dashboard, signed with HMAC-SHA256 of the body.
 * Messages without a code are dropped silently (newsletters, receipts).
 *
 * Secrets (wrangler secret put): ATTILA_WEBHOOK_URL, EMAIL_WORKER_SECRET.
 * The e-mail itself is never stored or forwarded anywhere else.
 */

const CODE_RE = /(?<![\d-])(\d{4,8})(?![\d-])/;

async function sign(secret, body) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readText(message) {
  const raw = await new Response(message.raw).text();
  // A crude but sufficient reduction: strip MIME/HTML noise, keep the words.
  return raw
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ");
}

function firstCode(subject, body) {
  // The subject often carries the code ("123456 is your verification code");
  // otherwise the first standalone 4–8 digit run of the body.
  const fromSubject = CODE_RE.exec(subject ?? "");
  if (fromSubject) return fromSubject[1];
  const fromBody = CODE_RE.exec(body.replace(/\s+/g, " "));
  return fromBody ? fromBody[1] : null;
}

export default {
  async email(message, env) {
    const subject = message.headers.get("subject") ?? "";
    const body = await readText(message);
    const code = firstCode(subject, body);
    if (!code) return;

    const payload = JSON.stringify({
      recipient: message.to,
      sender: message.from,
      subject: subject.slice(0, 500),
      code,
      receivedAt: new Date().toISOString(),
    });
    const signature = await sign(env.EMAIL_WORKER_SECRET, payload);
    const res = await fetch(env.ATTILA_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-attila-signature": signature },
      body: payload,
    });
    if (!res.ok) {
      console.log(`webhook ${res.status} for a code sent to ${message.to}`);
    }
  },
};
