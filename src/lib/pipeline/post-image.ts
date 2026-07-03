import { pipelineLog } from "./types";

/**
 * Download the post's still image (TikTok cover / photo, Twitter media) so
 * the vision analyst and writer can see the actual content, not just the
 * caption. TikTok captions are often nothing but hashtags — the cover frame
 * carries most of the meaning.
 *
 * We fetch server-side and ship base64 to Aleria instead of passing the URL
 * through, because Gorgone harvests *signed* CDN URLs that expire a few
 * hours after collection and may be geo-fenced. Fetching ourselves means we
 * detect a dead link in milliseconds and degrade to text-only, rather than
 * burning an LLM round-trip (and a retry budget) on a URL Aleria can't read.
 *
 * Failures are never fatal: any error returns null and the pipeline runs
 * text-only, exactly as it did before vision support.
 */

const FETCH_TIMEOUT_MS = 8_000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Formats the vision endpoint accepts as base64 data URLs. HEIC/AVIF are
 * skipped — TikTok serves them for some origin covers and VL models
 * generally reject them. */
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export interface PostImage {
  data: Buffer;
  mediaType: string;
}

export async function fetchPostImage(
  url: string | null | undefined,
  postId: string,
): Promise<PostImage | null> {
  if (!url) return null;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        // TikTok/Twitter CDNs occasionally 403 headless UAs; a browser UA is
        // enough for public media.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
    });

    if (!res.ok) {
      pipelineLog("analyst", postId, `Post image fetch failed (${res.status}) — text-only`);
      return null;
    }

    const mediaType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!SUPPORTED_TYPES.has(mediaType)) {
      pipelineLog("analyst", postId, `Post image type unsupported (${mediaType || "unknown"}) — text-only`);
      return null;
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      pipelineLog("analyst", postId, `Post image size out of bounds (${bytes.length} B) — text-only`);
      return null;
    }

    return { data: bytes, mediaType };
  } catch (err) {
    pipelineLog("analyst", postId, "Post image fetch crashed — text-only", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
