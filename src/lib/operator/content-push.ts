import type { RequestSession } from "@/lib/auth/session";
import { canUserAccessDevice } from "@/lib/auth/session";
import { boxFetch, shell } from "@/lib/box-api";

/**
 * Content push core — the single implementation behind the Server Action
 * (`src/app/actions/content.ts` → `pushContentToDevice`) and the native REST
 * route (`/api/content/push`). Downloads the file from Supabase Storage via a
 * short-lived signed URL and hands that URL to the box, which pulls it into
 * the device's media folders.
 */
export async function pushContentToDeviceCore(
  ctx: RequestSession,
  contentId: string,
  deviceId: string,
): Promise<{ error: string | null }> {
  try {
    const [{ data: item }, { data: device }] = await Promise.all([
      ctx.supabase
        .from("content_items")
        .select("*")
        .eq("id", contentId)
        .single(),
      ctx.supabase
        .from("devices")
        .select("id, db_id, box_id, account_id, boxes(tunnel_hostname)")
        .eq("id", deviceId)
        .single(),
    ]);

    if (!item) return { error: "Content not found" };
    if (!device) return { error: "Device not found" };

    const box = device.boxes as unknown as { tunnel_hostname: string } | null;
    if (!box) return { error: "Box not found" };

    const deviceAllowed = await canUserAccessDevice(
      ctx.session,
      {
        box_id: device.box_id as string,
        account_id: device.account_id as string | null,
      },
      ctx.supabase,
    );
    if (!deviceAllowed) return { error: "Forbidden" };

    if (
      ctx.session.profile.role !== "admin" &&
      item.account_id !== ctx.session.profile.account_id
    ) {
      return { error: "Forbidden" };
    }

    const { data: signedUrl } = await ctx.supabase.storage
      .from("content")
      .createSignedUrl(item.storage_path as string, 300);

    if (!signedUrl?.signedUrl) return { error: "Could not generate download URL" };

    const isVideo = (item.mime_type as string).startsWith("video/");
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

    // Trigger media scanner so the file appears in gallery/camera roll. Go
    // through `shell()` (not raw boxFetch) so the request carries the required
    // `id` field and container-not-ready (VMOS code 201) is handled uniformly.
    await shell(
      box.tunnel_hostname,
      device.db_id as string,
      `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${destPath}${item.file_name}`,
    );

    await ctx.supabase
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
