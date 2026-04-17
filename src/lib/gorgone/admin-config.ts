import { createGorgoneClient } from "./client";

/**
 * Admin operations against Gorgone's `integration_config` and
 * `zones.push_to_attila` columns.
 *
 * Source of truth for the webhook secret is Attila's environment
 * (`GORGONE_WEBHOOK_SECRET`); we mirror it into Gorgone via these
 * functions so the trigger can sign outgoing requests.
 *
 * To rotate the secret: change `GORGONE_WEBHOOK_SECRET` in Attila's
 * environment, then call `syncWebhookConfigToGorgone()`. Both sides
 * are updated atomically.
 */

const KEY_URL = "attila_webhook_url";
const KEY_SECRET = "attila_webhook_secret";

interface IntegrationConfigRow {
  key: string;
  value: string;
}

export interface AttilaWebhookConfig {
  url: string | null;
  secret: string | null;
}

export async function getAttilaWebhookConfig(): Promise<AttilaWebhookConfig> {
  const gorgone = createGorgoneClient();
  const { data, error } = await gorgone
    .from("integration_config")
    .select("key, value")
    .in("key", [KEY_URL, KEY_SECRET]);

  if (error) throw new Error(`gorgone integration_config: ${error.message}`);

  const map = new Map<string, string>();
  for (const row of (data ?? []) as IntegrationConfigRow[]) {
    map.set(row.key, row.value);
  }
  return {
    url: map.get(KEY_URL) ?? null,
    secret: map.get(KEY_SECRET) ?? null,
  };
}

/**
 * Pushes Attila's webhook URL + secret to Gorgone's `integration_config`.
 * Uses upsert so it's safe to call repeatedly.
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
    .from("integration_config")
    .upsert(
      [
        { key: KEY_URL, value: input.url },
        { key: KEY_SECRET, value: input.secret },
      ],
      { onConflict: "key" },
    );

  if (error) throw new Error(`gorgone integration_config upsert: ${error.message}`);
}

/**
 * Toggles Gorgone's `zones.push_to_attila` flag — the master on/off
 * switch for ingestion of a given zone. When `true`, every INSERT on
 * `twitter_tweets` / `tiktok_videos` for this zone fires the webhook.
 */
export async function setZonePushToAttila(
  zoneId: string,
  enabled: boolean,
): Promise<void> {
  const gorgone = createGorgoneClient();
  const { error } = await gorgone
    .from("zones")
    .update({ push_to_attila: enabled })
    .eq("id", zoneId);

  if (error) throw new Error(`gorgone zones.push_to_attila: ${error.message}`);
}

/**
 * Reads the current `push_to_attila` state for a set of zones.
 * Returned as a Map for cheap lookup in the admin UI.
 */
export async function getZonePushStates(
  zoneIds: string[],
): Promise<Map<string, boolean>> {
  if (zoneIds.length === 0) return new Map();

  const gorgone = createGorgoneClient();
  const { data, error } = await gorgone
    .from("zones")
    .select("id, push_to_attila")
    .in("id", zoneIds);

  if (error) throw new Error(`gorgone zones read: ${error.message}`);

  const map = new Map<string, boolean>();
  for (const row of (data ?? []) as { id: string; push_to_attila: boolean | null }[]) {
    map.set(row.id, Boolean(row.push_to_attila));
  }
  return map;
}
