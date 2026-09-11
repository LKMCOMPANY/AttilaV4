import { fetchScreenshotJpeg, screenshot } from "@/lib/box-api";
import type { DeviceRef } from "@/lib/engine/device";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Private bucket: third-party content is on these screens; served through signed URLs only. */
export const PROOFS_BUCKET = "maintenance-proofs";

/** How long a signed proof URL stays valid once minted for a client. */
export const PROOF_URL_TTL_SECONDS = 600;

/**
 * Take a screenshot (v2 JPEG, v1 PNG as fallback) and store it under
 * `account/avatar/task/NN-step.jpg`. Returns the storage path, or null when
 * nothing could be captured or stored — a missing proof never fails a task.
 */
export async function captureProof(
  supabase: AdminClient,
  dev: DeviceRef,
  key: { accountId: string; avatarId: string; taskId: string; index: number; name: string },
): Promise<string | null> {
  let bytes = await fetchScreenshotJpeg(dev.tunnelHostname, dev.dbId);
  let contentType = "image/jpeg";
  let extension = "jpg";
  if (bytes.length === 0) {
    try {
      bytes = await screenshot(dev.tunnelHostname, dev.dbId);
      contentType = "image/png";
      extension = "png";
    } catch {
      return null;
    }
  }
  if (bytes.length === 0) return null;
  return storeProof(supabase, key, bytes, contentType, extension);
}

/**
 * Store bytes a flow already captured (the reply flows hand back their own
 * source and proof screenshots) under the same path grammar as `captureProof`.
 */
export async function storeProof(
  supabase: AdminClient,
  key: { accountId: string; avatarId: string; taskId: string; index: number; name: string },
  bytes: Buffer,
  contentType = "image/jpeg",
  extension = "jpg",
): Promise<string | null> {
  if (bytes.length === 0) return null;
  const safeName = key.name.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 40);
  const path = `${key.accountId}/${key.avatarId}/${key.taskId}/${String(key.index).padStart(2, "0")}-${safeName}.${extension}`;
  const { error } = await supabase.storage.from(PROOFS_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) {
    console.error(`[Maintenance] proof upload failed for ${path}: ${error.message}`);
    return null;
  }
  return path;
}

/** A short-lived URL for one proof path (the clients never see the bucket). */
export async function signProofUrl(supabase: AdminClient, path: string): Promise<{ url: string; expiresAt: string } | null> {
  const { data, error } = await supabase.storage.from(PROOFS_BUCKET).createSignedUrl(path, PROOF_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return { url: data.signedUrl, expiresAt: new Date(Date.now() + PROOF_URL_TTL_SECONDS * 1000).toISOString() };
}
