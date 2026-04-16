import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase Realtime broadcast utility.
 *
 * Uses HTTP REST (not WebSocket) by sending before subscribing — the
 * recommended approach for server-to-client broadcast per Supabase docs.
 * Fire-and-forget — never blocks the caller.
 *
 * Channel naming convention: `campaign:<campaignId>`
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CampaignEventType = "pipeline" | "counters";

export interface CampaignBroadcastPayload {
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Broadcast a campaign event to all subscribed clients.
 * Non-blocking: errors are logged, never thrown.
 *
 * Sends WITHOUT subscribing first → uses HTTP REST internally,
 * no WebSocket connection required on the server side.
 */
export function broadcastCampaignEvent(
  campaignId: string,
  event: CampaignEventType,
  payload: CampaignBroadcastPayload = {},
): void {
  const client = getBroadcastClient();
  if (!client) return;

  const channel = client.channel(`campaign:${campaignId}`);

  channel
    .send({ type: "broadcast", event, payload })
    .then(() => client.removeChannel(channel))
    .catch(() => client.removeChannel(channel));
}
