import { createGorgoneClient } from "./client";
import type { GorgoneNetwork } from "@/types";

/**
 * Read-only directory queries against Gorgone V4 (`accounts`, `zones`,
 * `attila_zone_directory`). Used by the admin UI to populate the
 * link dialog and the per-link zone list.
 *
 * V4 unifies the multi-tenant model around `accounts` (Supabase Auth) — V3's
 * separate `clients` table is gone. The `attila_zone_directory` view exposes
 * per-zone subscription state + the networks actually polled by active rules,
 * so the admin UI can (a) show what's eligible, (b) warn when a subscription
 * targets a network with no active rule (zero data forever) or vice versa.
 */

export interface GorgoneAccount {
  id: string;
  name: string;
  status: "active" | "standby" | "archived";
}

export interface GorgoneZoneDirectoryRow {
  zone_id: string;
  account_id: string;
  zone_name: string;
  zone_is_active: boolean;
  /** Null when no row exists in `attila_zone_subscriptions`. */
  subscription_is_active: boolean | null;
  /** Subset of GorgoneNetwork — what we'll receive when active. */
  subscribed_networks: GorgoneNetwork[];
  /** Networks actually polled by at least one active rule on this zone. */
  active_rule_networks: GorgoneNetwork[];
}

export async function fetchGorgoneAccounts(): Promise<GorgoneAccount[]> {
  const gorgone = createGorgoneClient();
  const { data, error } = await gorgone
    .from("accounts")
    .select("id, name, status")
    .eq("status", "active")
    .order("name", { ascending: true });

  if (error) throw new Error(`fetch gorgone accounts: ${error.message}`);
  return (data ?? []) as GorgoneAccount[];
}

/**
 * Returns every zone for the given Gorgone account, enriched with the
 * subscription state and the set of networks that actually have active
 * rules running. The view does the join in a single round-trip.
 */
export async function fetchGorgoneZoneDirectory(
  gorgoneAccountId: string,
): Promise<GorgoneZoneDirectoryRow[]> {
  const gorgone = createGorgoneClient();
  const { data, error } = await gorgone
    .from("attila_zone_directory")
    .select("*")
    .eq("account_id", gorgoneAccountId)
    .order("zone_name", { ascending: true });

  if (error) throw new Error(`fetch gorgone zones: ${error.message}`);
  return (data ?? []) as GorgoneZoneDirectoryRow[];
}
