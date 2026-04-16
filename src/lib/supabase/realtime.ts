import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase Realtime broadcast utility.
 *
 * Uses HTTP REST (not WebSocket) by sending before subscribing — the
 * recommended approach for server-to-client broadcast per Supabase docs.
 * Fire-and-forget — never blocks the caller.
 *
 * Channel conventions:
 *   `campaign:<campaignId>` — automator page (per-campaign)
 *   `account:<accountId>`   — operator page (per-account)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CampaignEventType = "pipeline" | "counters";
export type AccountEventType = "jobs" | "devices";

export interface BroadcastPayload {
  action?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Singleton broadcast client (survives across invocations in same worker)
// ---------------------------------------------------------------------------

let _client: ReturnType<typeof createClient> | null = null;

function getBroadcastClient() {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;

    _client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Internal send helper
// ---------------------------------------------------------------------------

function broadcast(channelName: string, event: string, payload: BroadcastPayload): void {
  const client = getBroadcastClient();
  if (!client) return;

  const channel = client.channel(channelName);
  channel
    .send({ type: "broadcast", event, payload })
    .then(() => client.removeChannel(channel))
    .catch(() => client.removeChannel(channel));
}

// ---------------------------------------------------------------------------
// Public API — Campaign channel (Automator page)
// ---------------------------------------------------------------------------

export function broadcastCampaignEvent(
  campaignId: string,
  event: CampaignEventType,
  payload: BroadcastPayload = {},
): void {
  broadcast(`campaign:${campaignId}`, event, payload);
}

// ---------------------------------------------------------------------------
// Public API — Account channel (Operator page)
// ---------------------------------------------------------------------------

export function broadcastAccountEvent(
  accountId: string,
  event: AccountEventType,
  payload: BroadcastPayload = {},
): void {
  broadcast(`account:${accountId}`, event, payload);
}
