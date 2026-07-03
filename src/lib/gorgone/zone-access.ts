import type { SupabaseClient } from "@supabase/supabase-js";
import { createGorgoneClient } from "./client";

/**
 * Tenant guard: a Gorgone zone may only be read (capacity estimates) or
 * attached to a campaign by the Attila account whose `gorgone_links`
 * point to the Gorgone account owning that zone.
 *
 * `zone_id` arrives as free input from the client — without this check
 * any authenticated user could probe volume statistics of another
 * client's zones.
 */
export async function verifyZoneAccess(
  attila: SupabaseClient,
  accountId: string,
  zoneId: string,
): Promise<boolean> {
  const { data: links, error: linkErr } = await attila
    .from("gorgone_links")
    .select("gorgone_account_id")
    .eq("account_id", accountId)
    .eq("is_active", true);

  if (linkErr) throw new Error(`verifyZoneAccess links: ${linkErr.message}`);

  const gorgoneAccountIds = (links ?? [])
    .map((l) => l.gorgone_account_id as string | null)
    .filter((id): id is string => Boolean(id));
  if (gorgoneAccountIds.length === 0) return false;

  const gorgone = createGorgoneClient();
  const { data: zone, error: zoneErr } = await gorgone
    .from("zones")
    .select("account_id")
    .eq("id", zoneId)
    .maybeSingle();

  if (zoneErr) throw new Error(`verifyZoneAccess zone: ${zoneErr.message}`);
  if (!zone) return false;

  return gorgoneAccountIds.includes(zone.account_id as string);
}
