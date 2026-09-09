/**
 * Container lifecycle: start, wait for Android to be booted, stop.
 *
 * `state: running` from VMOS proves a container process exists, not that
 * Android is up — every entry point here waits for `rom_status` 200 and
 * `sys.boot_completed=1` before returning "ready" (AGENTS.md hard rule 1).
 */

import { boxFetch } from "./fetch";
import { fetchContainerDetail } from "./containers";
import { shellSafe } from "./shell";
import type { VmosResponse } from "./types";

const ROM_READY_POLL_MS = 1500;
const ROM_READY_TIMEOUT_MS = 120_000; // covers container start + Android boot
const BOOT_CONFIRM_RETRIES = 3;
const BOOT_CONFIRM_INTERVAL_MS = 1000;

/**
 * Ensure the container is running AND Android has finished booting.
 *
 * Fast path: poll the VMOS `rom_status` endpoint (code 200 = ROM ready) — one
 * lightweight GET that reflects both "container up" and "Android booted", so it
 * replaces the older two-phase (container-status + getprop) polling. A final
 * `getprop sys.boot_completed` then confirms Android's own signal before any
 * shell input is driven. Verified live (07/2026): `rom_status` never reports
 * 200 before `sys.boot_completed=1`, so this is a fast gate with a canonical
 * guard. Throws if the ROM is not ready within the deadline.
 */
export async function ensureContainerReady(
  tunnelHostname: string,
  dbId: string,
): Promise<{ wasStarted: boolean; durationMs: number }> {
  const start = Date.now();
  const { wasStarted } = await startContainerProcess(tunnelHostname, dbId);

  await waitForRomReady(tunnelHostname, dbId, ROM_READY_TIMEOUT_MS);
  await confirmBootCompleted(tunnelHostname, dbId);

  const durationMs = Date.now() - start;
  console.log(`[Container] ${dbId} ready (wasStarted=${wasStarted}, durationMs=${durationMs})`);
  return { wasStarted, durationMs };
}

/** VMOS ROM readiness code: 200 = ready, 1 = running but not ready, 0 = not started. */
export async function fetchRomStatus(tunnelHostname: string, dbId: string): Promise<number> {
  const res = await boxFetch<VmosResponse<unknown>>(
    tunnelHostname,
    `/container_api/v1/rom_status/${dbId}`,
  );
  return res.code ?? -1;
}

/** Poll `rom_status` until the ROM reports ready (code 200) or the deadline hits. */
async function waitForRomReady(
  tunnelHostname: string,
  dbId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await fetchRomStatus(tunnelHostname, dbId)) === 200) return;
    await new Promise((r) => setTimeout(r, ROM_READY_POLL_MS));
  }
  throw new Error(`Container ${dbId} ROM not ready within ${timeoutMs}ms`);
}

/**
 * Canonical final guard: Android's own `sys.boot_completed`. rom_status==200 and
 * this flip together, but we confirm the OS signal (short retry) before driving
 * shell input — matches the automation contract that jobs run on a booted ROM.
 */
async function confirmBootCompleted(tunnelHostname: string, dbId: string): Promise<void> {
  for (let attempt = 0; attempt < BOOT_CONFIRM_RETRIES; attempt++) {
    const result = await shellSafe(tunnelHostname, dbId, "getprop sys.boot_completed");
    if (result && result.code === 200 && result.message.trim() === "1") return;
    await new Promise((r) => setTimeout(r, BOOT_CONFIRM_INTERVAL_MS));
  }
  throw new Error(`Container ${dbId} ROM ready but sys.boot_completed != 1`);
}

/**
 * Stop the container unless this device still has *imminent* work: a job
 * executing now, or a `ready` job that is already DUE (`scheduled_at <= now`).
 *
 * A `ready` job scheduled in the FUTURE (retry backoff, staggered send) must
 * NOT keep the container alive. Otherwise a container started for a job that
 * fails pre-compose and re-queues with a 2-min backoff stays running, idle,
 * for the whole backoff — and these idle containers accumulate until they
 * saturate the box's automator slots, deadlocking every other job on the box
 * (observed live: box-1 stuck ~9h behind two idle retry containers). Stopping
 * now frees the slot; a later cycle cold-starts the container fresh when the
 * retry is actually due — which is also the better state to retry from.
 *
 * Best-effort: a network failure is logged but does not throw.
 */
export async function stopContainerIfIdle(
  tunnelHostname: string,
  dbId: string,
  deviceId: string,
  supabase: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { count } = await supabase
    .from("campaign_jobs")
    .select("*", { count: "exact", head: true })
    .eq("device_id", deviceId)
    .or(`status.eq.executing,and(status.eq.ready,scheduled_at.lte.${nowIso})`);

  if (count && count > 0) {
    console.log(`[Container] ${dbId} kept running — ${count} due/executing job(s) on this device`);
    return;
  }

  console.log(`[Container] ${dbId} stopping — no pending jobs`);
  try {
    await stopContainer(tunnelHostname, dbId);
    await supabase
      .from("devices")
      .update({ state: "stopped", last_seen: new Date().toISOString() })
      .eq("id", deviceId);
  } catch (err) {
    console.error(`[Container] ${dbId} stop failed:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Issue the container `run` without waiting for Android to finish booting.
 *
 * Used by the operator "Start" action: the box only needs the run command;
 * actual streamability is gated client-side by the `/stream-ready` probe and
 * the stream's own warm-up retry. This keeps the Start button responsive
 * (~1–2s) instead of blocking for the full ~10–90s boot like
 * `ensureContainerReady` (which the automation pipeline still needs because it
 * immediately drives shell commands).
 */
export async function startContainerProcess(
  tunnelHostname: string,
  dbId: string,
): Promise<{ wasStarted: boolean }> {
  const detail = await fetchContainerDetail(tunnelHostname, dbId);
  if (detail?.status === "running") return { wasStarted: false };

  console.log(`[Container] ${dbId} status=${detail?.status ?? "unknown"} — issuing run`);
  await boxFetch(tunnelHostname, "/container_api/v1/run", {
    method: "POST",
    body: JSON.stringify({ db_ids: [dbId] }),
  });
  return { wasStarted: true };
}

/**
 * Stop the container unconditionally. Used by operator-initiated stop.
 */
export async function stopContainer(tunnelHostname: string, dbId: string): Promise<void> {
  await boxFetch(tunnelHostname, "/container_api/v1/stop", {
    method: "POST",
    body: JSON.stringify({ db_ids: [dbId] }),
  });
}
