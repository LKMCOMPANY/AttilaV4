"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  fetchGorgoneClients as fetchClients,
  fetchGorgoneZones as fetchZones,
  syncZoneTweets,
  syncZoneTiktok,
} from "@/lib/gorgone";
import type {
  GorgoneLink,
  GorgoneLinkWithCursors,
  GorgoneSyncCursor,
} from "@/types";
import type { GorgoneClient } from "@/lib/gorgone/types";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const linkSchema = z.object({
  accountId: z.string().uuid(),
  gorgoneClientId: z.string().uuid(),
  gorgoneClientName: z.string().min(1),
});

const unlinkSchema = z.object({
  linkId: z.string().uuid(),
});

const toggleSchema = z.object({
  cursorId: z.string().uuid(),
  isActive: z.boolean(),
});

const syncSchema = z.object({
  cursorId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getGorgoneLinks(
  accountId: string
): Promise<GorgoneLinkWithCursors[]> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: links, error } = await supabase
    .from("gorgone_links")
    .select("*, gorgone_sync_cursors(*)")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (links ?? []).map((link) => ({
    ...link,
    cursors: (link.gorgone_sync_cursors ?? []) as GorgoneSyncCursor[],
    gorgone_sync_cursors: undefined,
  })) as unknown as GorgoneLinkWithCursors[];
}

export async function getGorgoneClients(): Promise<GorgoneClient[]> {
  await requireAdmin();
  return fetchClients();
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function linkGorgoneClient(
  input: z.infer<typeof linkSchema>
): Promise<{ data: GorgoneLink | null; error: string | null }> {
  await requireAdmin();

  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();

  // Insert the link
  const { data: link, error: linkError } = await supabase
    .from("gorgone_links")
    .insert({
      account_id: parsed.data.accountId,
      gorgone_client_id: parsed.data.gorgoneClientId,
      gorgone_client_name: parsed.data.gorgoneClientName,
    })
    .select()
    .single();

  if (linkError) {
    if (linkError.code === "23505") {
      return { data: null, error: "This Gorgone client is already linked to this account." };
    }
    return { data: null, error: linkError.message };
  }

  // Fetch zones and create cursors
  try {
    const zones = await fetchZones(parsed.data.gorgoneClientId);

    const cursors = zones.flatMap((zone) => {
      const platforms: string[] = [];
      if (zone.data_sources?.twitter) platforms.push("twitter");
      if (zone.data_sources?.tiktok) platforms.push("tiktok");

      return platforms.map((platform) => ({
        gorgone_link_id: link.id,
        account_id: parsed.data.accountId,
        zone_id: zone.id,
        zone_name: zone.name,
        platform,
      }));
    });

    if (cursors.length > 0) {
      await supabase.from("gorgone_sync_cursors").insert(cursors);
    }
  } catch {
    // Link created successfully, cursors can be added later
  }

  revalidatePath("/admin/accounts");
  return { data: link as GorgoneLink, error: null };
}

export async function refreshGorgoneZones(
  input: z.infer<typeof unlinkSchema>
): Promise<{ added: number; error: string | null }> {
  await requireAdmin();

  const parsed = unlinkSchema.safeParse(input);
  if (!parsed.success) return { added: 0, error: parsed.error.issues[0].message };

  const supabase = await createClient();

  const { data: link, error: linkError } = await supabase
    .from("gorgone_links")
    .select("*, gorgone_sync_cursors(zone_id, platform)")
    .eq("id", parsed.data.linkId)
    .single();

  if (linkError || !link) return { added: 0, error: "Link not found" };

  const existingKeys = new Set(
    ((link.gorgone_sync_cursors ?? []) as { zone_id: string; platform: string }[])
      .map((c) => `${c.zone_id}:${c.platform}`)
  );

  const zones = await fetchZones(link.gorgone_client_id);

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
    const { error } = await supabase.from("gorgone_sync_cursors").insert(newCursors);
    if (error) return { added: 0, error: error.message };
  }

  revalidatePath("/admin/accounts");
  return { added: newCursors.length, error: null };
}

export async function unlinkGorgoneClient(
  input: z.infer<typeof unlinkSchema>
): Promise<{ error: string | null }> {
  await requireAdmin();

  const parsed = unlinkSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();

  const { error } = await supabase
    .from("gorgone_links")
    .delete()
    .eq("id", parsed.data.linkId);

  if (error) return { error: error.message };

  revalidatePath("/admin/accounts");
  return { error: null };
}

export async function toggleZoneSync(
  input: z.infer<typeof toggleSchema>
): Promise<{ error: string | null }> {
  await requireAdmin();

  const parsed = toggleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();

  const { error } = await supabase
    .from("gorgone_sync_cursors")
    .update({
      is_active: parsed.data.isActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.cursorId);

  if (error) return { error: error.message };

  revalidatePath("/admin/accounts");
  return { error: null };
}

export async function triggerManualSync(
  input: z.infer<typeof syncSchema>
): Promise<{ synced: number; error: string | null }> {
  await requireAdmin();

  const parsed = syncSchema.safeParse(input);
  if (!parsed.success) return { synced: 0, error: parsed.error.issues[0].message };

  const supabase = await createClient();

  const { data: cursor, error: cursorError } = await supabase
    .from("gorgone_sync_cursors")
    .select("*")
    .eq("id", parsed.data.cursorId)
    .single();

  if (cursorError || !cursor) {
    return { synced: 0, error: "Cursor not found" };
  }

  const typedCursor = cursor as GorgoneSyncCursor;
  const result =
    typedCursor.platform === "twitter"
      ? await syncZoneTweets(supabase, typedCursor)
      : await syncZoneTiktok(supabase, typedCursor);

  revalidatePath("/admin/accounts");
  return { synced: result.synced, error: result.error ?? null };
}
