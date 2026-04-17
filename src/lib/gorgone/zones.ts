import { createGorgoneClient } from "./client";

/**
 * Read-only directory queries against Gorgone (clients + zones).
 * Used by the admin UI to populate the linking dialog and the
 * per-link zone list.
 */

export interface GorgoneClient {
  id: string;
  name: string;
  is_active: boolean;
}

export interface GorgoneZone {
  id: string;
  name: string;
  client_id: string;
  is_active: boolean;
  push_to_attila: boolean;
  data_sources: {
    twitter?: boolean;
    tiktok?: boolean;
    media?: boolean;
  };
}

export async function fetchGorgoneClients(): Promise<GorgoneClient[]> {
  const gorgone = createGorgoneClient();
  const { data, error } = await gorgone
    .from("clients")
    .select("id, name, is_active")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) throw new Error(`fetch gorgone clients: ${error.message}`);
  return (data ?? []) as GorgoneClient[];
}

export async function fetchGorgoneZones(
  gorgoneClientId: string,
): Promise<GorgoneZone[]> {
  const gorgone = createGorgoneClient();
  const { data, error } = await gorgone
    .from("zones")
    .select("id, name, client_id, is_active, push_to_attila, data_sources")
    .eq("client_id", gorgoneClientId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) throw new Error(`fetch gorgone zones: ${error.message}`);
  return (data ?? []) as GorgoneZone[];
}
