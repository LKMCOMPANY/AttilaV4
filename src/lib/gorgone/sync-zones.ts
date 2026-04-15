import { createGorgoneClient } from "./client";
import type { GorgoneClient, GorgoneZone } from "./types";

/**
 * Fetches all active clients from Gorgone.
 * Used by the admin UI to populate the linking dialog.
 */
export async function fetchGorgoneClients(): Promise<GorgoneClient[]> {
  const gorgone = createGorgoneClient();

  const { data, error } = await gorgone
    .from("clients")
    .select("id, name, is_active")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) throw new Error(`Failed to fetch Gorgone clients: ${error.message}`);
  return (data ?? []) as GorgoneClient[];
}

/**
 * Fetches zones for a specific Gorgone client that are active
 * and flagged for Attila integration.
 */
export async function fetchGorgoneZones(
  gorgoneClientId: string
): Promise<GorgoneZone[]> {
  const gorgone = createGorgoneClient();

  const { data, error } = await gorgone
    .from("zones")
    .select("id, name, client_id, is_active, push_to_attila, data_sources")
    .eq("client_id", gorgoneClientId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) throw new Error(`Failed to fetch Gorgone zones: ${error.message}`);
  return (data ?? []) as GorgoneZone[];
}
