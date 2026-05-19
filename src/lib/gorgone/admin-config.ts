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
// NOTE: read access goes through the `attila_zone_directory` view (see
// `directory.ts::fetchGorgoneZoneDirectory`) which joins zones with
// subscriptions and active rule networks in a single round-trip. Direct
// reads of `attila_zone_subscriptions` from outside that view aren't
// needed today and a duplicate fetcher would be code we don't run.

/**
 * Upserts the subscription for a zone. Pass an empty `networks` array OR
 * `is_active: false` to disable forwarding.
 *
 * Note: Gorgone's `accounts` table is the source of truth for `account_id`
 * — we re-resolve it from the zone instead of trusting the caller (defence
 * in depth on top of RLS).
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
 * Removes the subscription for a zone. Equivalent to disabling all networks,
 * but cleaner — used when an admin unlinks an entire account.
 */
export async function deleteZoneSubscription(zoneId: string): Promise<void> {
  const gorgone = createGorgoneClient();
  const { error } = await gorgone
    .from("attila_zone_subscriptions")
    .delete()
    .eq("zone_id", zoneId);

  if (error) throw new Error(`gorgone subscription delete: ${error.message}`);
}
