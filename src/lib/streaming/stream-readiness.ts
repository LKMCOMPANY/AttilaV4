/**
 * Client-side readiness gate for device streaming.
 *
 * The VMOS container list reports a `tcp_port` for a device well before the
 * in-container scrcpy server actually binds it (Android boots ~10–25s, up to
 * ~90s). Opening the stream WebSocket during that window produces a storm of
 * 502s and reconnect churn. This helper polls the box-side `/stream-ready`
 * probe (proxied through `/api/box/{boxId}/stream-ready/{dbId}`) until the
 * scrcpy port is genuinely accepting connections, so the stream opens once and
 * connects on the first try.
 */

interface WaitForStreamReadyOptions {
  signal: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
}

export type StreamReadyOutcome = "ready" | "timeout" | "aborted" | "unavailable";

const DEFAULT_INTERVAL_MS = 1000;
// Covers the worst observed cold-boot (~90s) with margin.
const DEFAULT_TIMEOUT_MS = 120_000;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(id);
      resolve();
    };
    const id = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Resolve once the device is streamable, or when we should stop waiting.
 *
 * - `ready`        : the box confirmed the scrcpy port is accepting.
 * - `timeout`      : the device never became ready within the budget.
 * - `aborted`      : the caller cancelled (e.g. operator switched device).
 * - `unavailable`  : the probe endpoint is missing/erroring (box not yet
 *                    deployed) — caller should fall back to a direct connect.
 *
 * On `timeout`/`unavailable` the caller may still attempt to connect; the
 * stream's own warm-up retry will cope. This keeps the gate strictly additive
 * and never regresses boxes that lack the probe.
 */
export async function waitForStreamReady(
  boxId: string,
  dbId: string,
  { signal, intervalMs = DEFAULT_INTERVAL_MS, timeoutMs = DEFAULT_TIMEOUT_MS }: WaitForStreamReadyOptions,
): Promise<StreamReadyOutcome> {
  const deadline = Date.now() + timeoutMs;
  const url = `/api/box/${boxId}/stream-ready/${dbId}`;

  while (!signal.aborted && Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal, cache: "no-store" });
      if (!res.ok) return "unavailable";
      const data = (await res.json()) as { ready?: boolean };
      if (data.ready) return "ready";
    } catch {
      if (signal.aborted) return "aborted";
      // Transient network/proxy hiccup — fall back so we don't dead-end the UI.
      return "unavailable";
    }

    await delay(intervalMs, signal);
  }

  return signal.aborted ? "aborted" : "timeout";
}
