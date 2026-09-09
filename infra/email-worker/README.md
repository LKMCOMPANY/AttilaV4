# Attila Email Worker

The platforms confirm a login on a known device with a code e-mailed to the
account's mailbox (measured 9 September 2026 on TikTok 45.2.3: tapping "Log in"
on the "Welcome back" screen sends the code straight away, no password step).
The avatars' mailboxes live on Cloudflare-managed domains; this worker turns
each inbound code into a row of `verification_codes` that the relogin recipe
consumes.

1. `wrangler deploy` from this folder.
2. `wrangler secret put ATTILA_WEBHOOK_URL` →
   `https://<dashboard host>/api/maintenance/verification-codes`.
3. `wrangler secret put EMAIL_WORKER_SECRET`, and set the same value as
   `EMAIL_WORKER_SECRET` on the Render web service.
4. For every mail domain of the avatars: Cloudflare → Email → Email Routing →
   Routes → catch-all → "Send to a Worker" → `attila-email-worker`.

Messages without a 4–8 digit code are dropped; the e-mail body is never stored.
