import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "proofs";

/**
 * Upload a screenshot buffer to Supabase Storage and return the public URL.
 * Returns null silently on empty buffer or upload failure — never blocks the job.
 */
export async function uploadProofScreenshot(
  buffer: Buffer | undefined,
  campaignId: string,
  jobId: string,
  type: "source" | "proof",
): Promise<string | null> {
  if (!buffer || buffer.length === 0) return null;

  const path = `${campaignId}/${jobId}_${type}.jpg`;
  const supabase = createAdminClient();

  try {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (error) {
      console.error(`[Storage] Upload failed for ${path}:`, error.message);
      return null;
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    console.log(`[Storage] Uploaded ${type} screenshot`, { path, bytes: buffer.length, url: data.publicUrl });
    return data.publicUrl;
  } catch (err) {
    console.error(`[Storage] Upload crashed for ${path}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
