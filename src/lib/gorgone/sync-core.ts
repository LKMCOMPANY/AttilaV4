import type { SupabaseClient } from "@supabase/supabase-js";
import type { GorgoneSyncCursor } from "@/types";
import { createGorgoneClient } from "./client";

export const BATCH_SIZE = 500;

export interface SyncResult {
  synced: number;
  newCursor: string | null;
  error?: string;
}

/**
 * Generic cursor-based sync: fetches rows from Gorgone, maps them,
 * upserts into Attila, and advances the cursor.
 */
export async function executeCursorSync<TRaw>(opts: {
  attila: SupabaseClient;
  cursor: GorgoneSyncCursor;
  gorgoneTable: string;
  gorgoneSelect: string;
  attilaTable: string;
  mapRow: (row: TRaw, accountId: string) => Record<string, unknown>;
}): Promise<SyncResult> {
  const { attila, cursor, gorgoneTable, gorgoneSelect, attilaTable, mapRow } = opts;
  const gorgone = createGorgoneClient();

  await attila
    .from("gorgone_sync_cursors")
    .update({ status: "syncing", updated_at: new Date().toISOString() })
    .eq("id", cursor.id);

  try {
    let query = gorgone
      .from(gorgoneTable)
      .select(gorgoneSelect)
      .eq("zone_id", cursor.zone_id)
      .order("collected_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (cursor.last_cursor) {
      query = query.gt("collected_at", cursor.last_cursor);
    } else {
      query = query.gte("collected_at", new Date().toISOString());
    }

    const { data: rows, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Gorgone query failed: ${fetchError.message}`);
    }

    const typedRows = rows as unknown as TRaw[] | null;
    if (!typedRows || typedRows.length === 0) {
      await markCursorIdle(attila, cursor.id);
      return { synced: 0, newCursor: cursor.last_cursor };
    }

    const mapped = typedRows.map((row) => mapRow(row, cursor.account_id));

    const { error: upsertError } = await attila
      .from(attilaTable)
      .upsert(mapped, { onConflict: "gorgone_id", ignoreDuplicates: true });

    if (upsertError) {
      throw new Error(`Attila upsert failed: ${upsertError.message}`);
    }

    const lastRow = typedRows[typedRows.length - 1] as Record<string, unknown>;
    const newCursor = lastRow.collected_at as string;

    await attila
      .from("gorgone_sync_cursors")
      .update({
        status: "idle",
        last_cursor: newCursor,
        last_synced_at: new Date().toISOString(),
        total_synced: cursor.total_synced + mapped.length,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cursor.id);

    return { synced: mapped.length, newCursor };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sync error";

    await attila
      .from("gorgone_sync_cursors")
      .update({
        status: "error",
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cursor.id);

    return { synced: 0, newCursor: cursor.last_cursor, error: message };
  }
}

async function markCursorIdle(attila: SupabaseClient, cursorId: string) {
  await attila
    .from("gorgone_sync_cursors")
    .update({
      status: "idle",
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", cursorId);
}
