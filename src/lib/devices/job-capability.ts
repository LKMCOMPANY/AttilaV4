import type { DeviceBootHealth, SocialPlatform } from "@/types";
import { actionableBootHealth } from "./boot-health";

/**
 * Can this device do a job on this platform — the one rule, for every caller
 * that picks a device for work (the campaign selector, the maintenance
 * planner).
 *
 * A device VMOS reports as `running` cannot necessarily work: it has to boot,
 * to carry the IME every job types with (ADBKeyboard), and to carry the app.
 * Each fact has its own audit and its own column; here they are read, never
 * measured. Two deliberate silences:
 *
 * - `null` is "never audited", not "missing": an unaudited device is not
 *   excluded, the audits set `false` explicitly when they look and find nothing.
 * - A boot verdict counts only while it is recent (`actionableBootHealth`,
 *   14 days) and only when it is `dead`: `unstable` boots, jobs may fail
 *   part-way, the executor already reports that as a typed failure.
 */
export type DeviceIncapability = "boot_dead" | "ime_missing" | "app_missing";

export interface JobCapabilityFacts {
  boot_health: DeviceBootHealth | null;
  boot_checked_at: string | null;
  adbkeyboard_installed: boolean | null;
  tiktok_installed: boolean | null;
  twitter_installed: boolean | null;
}

/** The columns a caller must select to evaluate the rule. */
export const JOB_CAPABILITY_COLUMNS =
  "boot_health, boot_checked_at, adbkeyboard_installed, tiktok_installed, twitter_installed";

/** The first reason the device cannot take a job on `platform`, or `null` when nothing observed forbids it. */
export function deviceIncapability(
  device: JobCapabilityFacts,
  platform: SocialPlatform,
  now: number = Date.now(),
): DeviceIncapability | null {
  if (actionableBootHealth(device, now) === "dead") return "boot_dead";
  if (device.adbkeyboard_installed === false) return "ime_missing";
  const app =
    platform === "tiktok" ? device.tiktok_installed : platform === "twitter" ? device.twitter_installed : null;
  if (app === false) return "app_missing";
  return null;
}
