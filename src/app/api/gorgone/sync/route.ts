import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  syncZoneTweets,
  syncZoneTiktok,
  fetchGorgoneZones,
} from "@/lib/gorgone";
import type { GorgoneSyncCursor } from "@/types";

interface SyncReport {
  zone: string;
  platform: string;
  synced: number;
  error?: string;
}

/**
 * POST /api/gorgone/sync
 *
 * Cron endpoint that syncs all active Gorgone zones.
 * Also auto-discovers new zones for each linked Gorgone client.
 * Protected by CRON_SECRET — no user session required.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const attila = createAdminClient();

  // Auto-discover new zones for all active links
  const zonesAdded = await discoverNewZones(attila);

  // Fetch all active cursors
  const { data: cursors, error: cursorError } = await attila
    .from("gorgone_sync_cursors")
    .select("*, gorgone_links!inner(is_active)")
    .eq("is_active", true)
    .eq("gorgone_links.is_active", true);

  if (cursorError) {
    return NextResponse.json(
      { error: `Failed to fetch cursors: ${cursorError.message}` },
      { status: 500 }
    );
  }

  const activeCursors = (cursors ?? []) as (GorgoneSyncCursor & {
    gorgone_links: { is_active: boolean };
  })[];

  const reports: SyncReport[] = [];

  for (const cursor of activeCursors) {
    const result =
      cursor.platform === "twitter"
        ? await syncZoneTweets(attila, cursor)
        : await syncZoneTiktok(attila, cursor);

    reports.push({
      zone: cursor.zone_name,
      platform: cursor.platform,
      synced: result.synced,
      ...(result.error && { error: result.error }),
    });
  }

  const totalSynced = reports.reduce((sum, r) => sum + r.synced, 0);
  const errors = reports.filter((r) => r.error).length;

  return NextResponse.json({
    ok: true,
    zones_added: zonesAdded,
    cursors_processed: reports.length,
    total_synced: totalSynced,
    errors,
    reports,
  });
}

/**
 * Checks all active gorgone_links for new zones in Gorgone
 * and creates missing cursors automatically.
 */
async function discoverNewZones(
  attila: ReturnType<typeof createAdminClient>
): Promise<number> {
  const { data: links } = await attila
    .from("gorgone_links")
    .select("id, account_id, gorgone_client_id, gorgone_sync_cursors(zone_id, platform)")
    .eq("is_active", true);

  if (!links || links.length === 0) return 0;

  let totalAdded = 0;

  for (const link of links) {
    const existingKeys = new Set(
      ((link.gorgone_sync_cursors ?? []) as { zone_id: string; platform: string }[])
        .map((c) => `${c.zone_id}:${c.platform}`)
    );

    try {
      const zones = await fetchGorgoneZones(link.gorgone_client_id);

      const newCursors = zones.flatMap((zone) => {
        const platforms: string[] = [];
        if (zone.data_sources?.twitter) platforms.push("twitter");
        if (zone.data_sources?.tiktok) platforms.push("tiktok");

        return platforms
          .filter((p) => !existingKeys.has(`${zone.id}:${p}`))
          .map((platform) => ({
            gorgone_link_id: link.id,
            account_id: link.account_id,
            zone_id: zone.id,
            zone_name: zone.name,
            platform,
          }));
      });

      if (newCursors.length > 0) {
        await attila.from("gorgone_sync_cursors").insert(newCursors);
        totalAdded += newCursors.length;
      }
    } catch {
      // Skip this link if Gorgone query fails, continue with others
    }
  }

  return totalAdded;
}
