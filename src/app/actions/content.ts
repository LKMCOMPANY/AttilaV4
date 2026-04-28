"use server";

import { createClient } from "@/lib/supabase/server";
import { canUserAccessDevice, requireSession } from "@/lib/auth/session";
import { boxFetch } from "@/lib/box-api";
import { z } from "zod";
import type { ContentItem } from "@/types";

// ---------------------------------------------------------------------------
// List content items for an avatar
// ---------------------------------------------------------------------------

export async function getContentItems(
  avatarId: string
): Promise<ContentItem[]> {
  const session = await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("content_items")
    .select("*")
    .eq("avatar_id", avatarId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  if (session.profile.role !== "admin") {
    return (data ?? []).filter(
      (item: ContentItem) => item.account_id === session.profile.account_id
    );
  }

  return data ?? [];
}

// ---------------------------------------------------------------------------
// Create content item record (after file is uploaded to storage)
// ---------------------------------------------------------------------------

const createSchema = z.object({
  accountId: z.string().uuid(),
  avatarId: z.string().uuid(),
  fileName: z.string().min(1),
  fileType: z.string().min(1),
  fileSize: z.number().positive(),
  mimeType: z.string().min(1),
  storagePath: z.string().min(1),
});

export async function createContentItem(
  input: z.infer<typeof createSchema>
): Promise<{ data: ContentItem | null; error: string | null }> {
  try {
    const session = await requireSession();
    const parsed = createSchema.parse(input);

    if (
      session.profile.role !== "admin" &&
      parsed.accountId !== session.profile.account_id
    ) {
      return { data: null, error: "Forbidden" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("content_items")
      .insert({
        account_id: parsed.accountId,
        avatar_id: parsed.avatarId,
        file_name: parsed.fileName,
        file_type: parsed.fileType,
        file_size: parsed.fileSize,
        mime_type: parsed.mimeType,
        storage_path: parsed.storagePath,
        status: "ready",
        created_by: session.profile.id,
      })
      .select()
      .single();

    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// Delete content item (removes file from storage too)
// ---------------------------------------------------------------------------

export async function deleteContentItem(
  contentId: string
): Promise<{ error: string | null }> {
  try {
    const session = await requireSession();
    const parsed = z.string().uuid().safeParse(contentId);
    if (!parsed.success) return { error: "Invalid content ID" };

    const supabase = await createClient();

    const { data: item } = await supabase
      .from("content_items")
      .select("storage_path, account_id")
      .eq("id", contentId)
      .single();

    if (!item) return { error: "Content not found" };

    if (
      session.profile.role !== "admin" &&
      item.account_id !== session.profile.account_id
    ) {
      return { error: "Forbidden" };
    }

    if (item.storage_path) {
      await supabase.storage.from("content").remove([item.storage_path]);
    }

    const { error } = await supabase
      .from("content_items")
      .delete()
      .eq("id", contentId);

    if (error) return { error: error.message };
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Push content to device — downloads from Supabase Storage, uploads to device
// ---------------------------------------------------------------------------

export async function pushContentToDevice(
  contentId: string,
  deviceId: string
): Promise<{ error: string | null }> {
  try {
    const session = await requireSession();
    const supabase = await createClient();

    const [{ data: item }, { data: device }] = await Promise.all([
      supabase
        .from("content_items")
        .select("*")
        .eq("id", contentId)
        .single(),
      supabase
        .from("devices")
        .select("id, db_id, box_id, account_id, boxes(tunnel_hostname)")
        .eq("id", deviceId)
        .single(),
    ]);

    if (!item) return { error: "Content not found" };
    if (!device) return { error: "Device not found" };

    const box = device.boxes as unknown as { tunnel_hostname: string } | null;
    if (!box) return { error: "Box not found" };

    const deviceAllowed = await canUserAccessDevice(session, {
      box_id: device.box_id,
      account_id: device.account_id as string | null,
    });
    if (!deviceAllowed) return { error: "Forbidden" };

    if (
      session.profile.role !== "admin" &&
      item.account_id !== session.profile.account_id
    ) {
      return { error: "Forbidden" };
    }

    const { data: signedUrl } = await supabase.storage
      .from("content")
      .createSignedUrl(item.storage_path, 300);

    if (!signedUrl?.signedUrl) return { error: "Could not generate download URL" };

    const isVideo = item.mime_type.startsWith("video/");
    const destPath = isVideo ? "/sdcard/DCIM/Camera/" : "/sdcard/Pictures/";

    await boxFetch<{ code: number; data: unknown }>(
      box.tunnel_hostname,
      "/android_api/v1/upload_file_from_url_batch",
      {
        method: "POST",
        body: JSON.stringify({
          db_ids: device.db_id,
          url: signedUrl.signedUrl,
          dest_path: destPath,
        }),
      }
    );

    // Trigger media scanner so the file appears in gallery/camera roll
    await boxFetch(
      box.tunnel_hostname,
      `/android_api/v1/shell/${device.db_id}`,
      {
        method: "POST",
        body: JSON.stringify({
          cmd: `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${destPath}${item.file_name}`,
        }),
      }
    );

    await supabase
      .from("content_items")
      .update({
        status: "pushed",
        pushed_to_device_id: deviceId,
        pushed_at: new Date().toISOString(),
      })
      .eq("id", contentId);

    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}
