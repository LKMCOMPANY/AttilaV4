/**
 * Low-level HTTP primitive for the box APIs, reached through the Cloudflare
 * tunnel. Every request carries the CF Access service token; nothing else in
 * the codebase builds a box URL by hand.
 */

export function getCfHeaders() {
  return {
    "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID!,
    "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET!,
  };
}

/** Default per-request deadline. Covers slow shell commands; caller can override. */
const BOX_FETCH_TIMEOUT_MS = 30_000;
const BOX_FETCH_RETRY_BACKOFF_MS = 400;

export interface BoxFetchInit extends RequestInit {
  /** Abort the request after this many ms (default 30s). */
  timeoutMs?: number;
  /**
   * Retry count on transport failure / timeout / 5xx / 429. Defaults to 2 for
   * idempotent GETs and 0 for POSTs — a POST like `shell` (`input tap`) is NOT
   * safe to replay, so callers that want POST retries must opt in explicitly.
   */
  retries?: number;
}

function isRetryableError(err: unknown): boolean {
  // AbortError (timeout) and low-level network errors (ECONNRESET, tunnel
  // hiccup) are transient; a fresh attempt commonly succeeds.
  if (err instanceof Error) {
    return (
      err.name === "AbortError" ||
      err.name === "TypeError" ||
      /network|fetch failed|ECONN|ETIMEDOUT|socket/i.test(err.message)
    );
  }
  return false;
}

export async function boxFetch<T>(
  tunnelHostname: string,
  path: string,
  init?: BoxFetchInit,
): Promise<T> {
  const url = `https://${tunnelHostname}${path}`;
  const { timeoutMs = BOX_FETCH_TIMEOUT_MS, retries, ...requestInit } = init ?? {};
  const method = (requestInit.method ?? "GET").toUpperCase();
  const maxRetries = retries ?? (method === "GET" ? 2 : 0);

  const headers = new Headers(requestInit.headers);
  Object.entries(getCfHeaders()).forEach(([k, v]) => headers.set(k, v));
  if (!headers.has("content-type") && method === "POST") {
    headers.set("content-type", "application/json");
  }

  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...requestInit,
        headers,
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) {
        if (attempt < maxRetries && (res.status >= 500 || res.status === 429)) {
          attempt++;
          await new Promise((r) => setTimeout(r, BOX_FETCH_RETRY_BACKOFF_MS * attempt));
          continue;
        }
        throw new Error(`Box API error: ${res.status} ${res.statusText} — ${url}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      if (attempt < maxRetries && isRetryableError(err)) {
        attempt++;
        await new Promise((r) => setTimeout(r, BOX_FETCH_RETRY_BACKOFF_MS * attempt));
        continue;
      }
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Box API timeout after ${timeoutMs}ms — ${url}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Fetch raw bytes from a box endpoint (screenshots). Same auth and deadline
 * handling as `boxFetch`, no JSON parsing, no retries — callers decide what a
 * missing image means for them.
 */
export async function boxFetchBytes(
  tunnelHostname: string,
  path: string,
  timeoutMs = BOX_FETCH_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; body: Buffer }> {
  const url = `https://${tunnelHostname}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: getCfHeaders(),
      cache: "no-store",
      signal: controller.signal,
    });
    const body = res.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}
