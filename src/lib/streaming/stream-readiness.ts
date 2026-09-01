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

export type StreamReadyOutcome =
  | "ready"
  | "timeout"
  | "aborted"
  | "unavailable"
  /** Android answers but scrcpy does not — only a restart clears this. */
  | "projection-dead"
  /** Neither answers though a container is listed — Android itself is down. */
  | "android-down";

/**
 * Operator-facing wording for the outcomes that need an action.
 *
 * Two registers: `label` fits the compact status strip under the phone frame,
 * `detail` carries the full explanation for a tooltip or a toast. Keep labels
 * under ~28 characters — the strip is 320 px of 10 px text.
 */
export interface StreamReadyDiagnosis {
  label: string;
  detail: string;
}

export const STREAM_READY_MESSAGES: Partial<Record<StreamReadyOutcome, StreamReadyDiagnosis>> = {
  "projection-dead": {
    label: "Projection dead — restart",
    detail:
      "Android is running but the screen-projection service died. Restarting the device brings the stream back.",
  },
  "android-down": {
    label: "Android down — restart",
    detail: "The container is up but Android is not responding. Restart the device.",
  },
};

/**
 * Map the box's `reason` to a TERMINAL outcome, or null to keep polling.
 *
 * Only `projection_dead` qualifies. There the in-guest agent answered, so
 * Android is provably up and scrcpy is provably not — waiting cannot fix it.
 *
 * `android_down` deliberately does NOT qualify: from the box, a device 20 s
 * into a 40 s boot is indistinguishable from a dead one — both have a listed
 * container, a silent agent and no handshake. Treating it as terminal made the
 * client give up on devices that were merely starting.
 */
function diagnose(reason: string | undefined): StreamReadyOutcome | null {
  return reason === "projection_dead" ? "projection-dead" : null;
}

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
 * - `ready`           : the box confirmed the stream is accepting.
 * - `timeout`         : the device never became ready within the budget.
 * - `aborted`         : the caller cancelled (e.g. operator switched device).
 * - `unavailable`     : the probe endpoint is missing/erroring (box not yet
 *                       deployed) — caller should fall back to a direct connect.
 * - `projection-dead` : Android is up, the projection stack is not.
 * - `android-down`    : the container is listed but Android is not answering.
 *
 * On `timeout`/`unavailable` the caller may still attempt to connect; the
 * stream's own warm-up retry will cope. This keeps the gate strictly additive
 * and never regresses boxes that lack the probe.
 *
 * The two diagnosed faults return IMMEDIATELY instead of burning the remaining
 * window: nothing about a dead projection stack heals by polling, and the
 * operator needs to be told to restart the device, not left watching a spinner
 * for two minutes. Requires magicbox-proxy ≥ 1.2.0.
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
      const data = (await res.json()) as { ready?: boolean; reason?: string };
      if (data.ready) return "ready";
      const diagnosed = diagnose(data.reason);
      if (diagnosed) return diagnosed;
    } catch {
      if (signal.aborted) return "aborted";
      // Transient network/proxy hiccup — fall back so we don't dead-end the UI.
      return "unavailable";
    }

    await delay(intervalMs, signal);
  }

  return signal.aborted ? "aborted" : "timeout";
}
