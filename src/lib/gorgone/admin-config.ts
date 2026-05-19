import { createGorgoneClient } from "./client";
import type { GorgoneNetwork } from "@/types";

/**
 * Admin operations against Gorgone V4's integration tables:
 *   - `attila_integration_config`  (kv: webhook_url, webhook_secret)
 *   - `attila_zone_subscriptions`  (per-zone activation + networks[])
 *
 * Source of truth for the webhook secret is Attila's environment
 * (`GORGONE_WEBHOOK_SECRET`). We mirror it into Gorgone via these
 * functions so the AFTER INSERT trigger on `posts` can sign the
 * outgoing pg_net request.
 *
 * Subscriptions replace V3's `zones.push_to_attila` boolean. The new
 * shape is richer: per-zone `is_active` + `networks[]`, so a single
 * zone can stream Twitter only OR Twitter + TikTok with one row.
 *
 * Both tables have RLS enabled with NO policies = service-role only.
 * That's intentional — the consumer (Attila) holds the service-role
 * key for Gorgone and never exposes these to authenticated users.
 */

const KEY_URL = "webhook_url";
const KEY_SECRET = "webhook_secret";

export interface AttilaWebhookConfig {
  url: string | null;
  secret: string | null;
}

export interface ZoneSubscription {
  zone_id: string;
  account_id: string;
  is_active: boolean;
  networks: GorgoneNetwork[];
}

// ---------------------------------------------------------------------------
// Webhook config
// ---------------------------------------------------------------------------

export async function getAttilaWebhookConfig(): Promise<AttilaWebhookConfig> {
  const gorgone = createGorgoneClient();
  const { data, error } = await gorgone
    .from("attila_integration_config")
    .select("key, value")
    .in("key", [KEY_URL, KEY_SECRET]);

  if (error) throw new Error(`gorgone integration_config read: ${error.message}`);

  const map = new Map<string, string>();
  for (const row of (data ?? []) as { key: string; value: string }[]) {
    map.set(row.key, row.value);
  }
  return {
    url: map.get(KEY_URL) ?? null,
    secret: map.get(KEY_SECRET) ?? null,
  };
}

/**
 * Pushes Attila's webhook URL + secret to Gorgone's `attila_integration_config`.
 * Idempotent (PK upsert).
 */
export async function syncWebhookConfigToGorgone(input: {
  url: string;
  secret: string;
}): Promise<void> {
  if (!/^https:\/\//.test(input.url)) {
    throw new Error("webhook url must be https://");
  }
  if (input.secret.length < 32) {
    throw new Error("webhook secret must be at least 32 characters");
  }

  const gorgone = createGorgoneClient();
  const { error } = await gorgone
    .from("attila_integration_config")
    .upsert(
      [
        { key: KEY_URL, value: input.url },
        { key: KEY_SECRET, value: input.secret },
      ],
      { onConflict: "key" },
    );

  if (error) throw new Error(`gorgone integration_config upsert: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Zone subscriptions
// ---------------------------------------------------------------------------
// Lifecycle (DWIM — Do What I Mean):
//   1. linkGorgoneAccount       → ensureZoneSubscriptions for every existing
//                                  zone of the linked Gorgone account
//                                  (defaults: active + supported networks).
//   2. getGorgoneLinks (refresh) → ensureZoneSubscriptions for any zone the
//                                  admin sees that doesn't yet have a row
//                                  (covers zones created in Gorgone after
//                                  the link was set up).
//   3. setZoneSubscription      → admin opt-out: UPDATEs the existing row
//                                  to is_active=false / networks=[]. We do
//                                  NOT delete the row, so step 2 won't
//                                  resurrect a sub the admin disabled
//                                  intentionally.
//   4. unlinkGorgoneAccount     → deleteZoneSubscriptionsForAccount wipes
//                                  every sub of the account (no orphans).
//
// NOTE on read access: it goes through the `attila_zone_directory` view
// (see `directory.ts::fetchGorgoneZoneDirectory`) which joins zones with
// subscriptions and active rule networks in a single round-trip. Direct
// reads of `attila_zone_subscriptions` from outside that view aren't
// needed today.

/**
 * Idempotent insert of subscriptions for a set of zones.
 * Existing rows are preserved (ON CONFLICT DO NOTHING) — that's how an
 * admin who turned a zone OFF keeps it off across page refreshes.
 *
 * Returns the number of NEW rows inserted (zones that had no sub yet).
 */
export async function ensureZoneSubscriptions(input: {
  gorgoneAccountId: string;
  zoneIds: string[];
  defaultNetworks: GorgoneNetwork[];
}): Promise<number> {
  if (input.zoneIds.length === 0) return 0;

  const gorgone = createGorgoneClient();

  const rows = input.zoneIds.map((zoneId) => ({
    zone_id: zoneId,
    account_id: input.gorgoneAccountId,
    is_active: true,
    networks: input.defaultNetworks,
  }));

  const { data, error } = await gorgone
    .from("attila_zone_subscriptions")
    .upsert(rows, { onConflict: "zone_id", ignoreDuplicates: true })
    .select("zone_id");

  if (error) {
    throw new Error(`gorgone subscriptions ensure: ${error.message}`);
  }
  return data?.length ?? 0;
}

/**
 * UPDATE the subscription row for a zone.
 *
 * - When `isActive=true && networks.length > 0` → forwards posts on those
 *   networks.
 * - When `isActive=false || networks=[]`        → row stays in place but
 *   the trigger early-returns. Crucial: we keep the row so the next
 *   `ensureZoneSubscriptions` pass doesn't resurrect it.
 *
 * This is the explicit admin override path (the "kill switch" toggle in
 * the UI). For the bulk auto-fill path, use `ensureZoneSubscriptions`.
 */
export async function upsertZoneSubscription(input: {
  zoneId: string;
  isActive: boolean;
  networks: GorgoneNetwork[];
}): Promise<void> {
  const gorgone = createGorgoneClient();

  const { data: zone, error: zoneErr } = await gorgone
    .from("zones")
    .select("id, account_id")
    .eq("id", input.zoneId)
    .single();

  if (zoneErr || !zone) {
    throw new Error(`zone ${input.zoneId} not found in Gorgone`);
  }

  const { error } = await gorgone
    .from("attila_zone_subscriptions")
    .upsert(
      {
        zone_id: input.zoneId,
        account_id: zone.account_id,
        is_active: input.isActive,
        networks: input.networks,
      },
      { onConflict: "zone_id" },
    );

  if (error) throw new Error(`gorgone subscription upsert: ${error.message}`);
}

/**
 * Drops every subscription tied to a Gorgone account. Used when the
 * admin unlinks the account from Attila — leaves no orphan rows that
 * would keep the trigger firing for posts no one consumes anymore.
 */
export async function deleteZoneSubscriptionsForAccount(
  gorgoneAccountId: string,
): Promise<number> {
  const gorgone = createGorgoneClient();
  const { data, error } = await gorgone
    .from("attila_zone_subscriptions")
    .delete()
    .eq("account_id", gorgoneAccountId)
    .select("zone_id");

  if (error) {
    throw new Error(`gorgone subscriptions delete: ${error.message}`);
  }
  return data?.length ?? 0;
}
