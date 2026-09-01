import type { DeviceBootHealth } from "@/types";

/**
 * How long a boot verdict is worth acting on.
 *
 * A container that failed to boot a month ago may well have been fixed by a
 * host maintenance pass since. Warning on a stale verdict trains operators to
 * ignore the badge, which costs more than saying nothing.
 */
export const BOOT_VERDICT_SHELF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

/** The three verdicts the boot sweep can reach, as a runtime guard. */
const KNOWN_VERDICTS = new Set<string>(["healthy", "unstable", "dead"]);

/**
 * The boot verdict, but only while it is still recent enough to trust — and
 * only when it is bad news.
 *
 * Returns `null` for the four situations that all warrant the same UI, which
 * is silence: never probed, probed too long ago, probed and healthy, or a
 * verdict this build does not recognise (the column is free text server-side,
 * and an unknown value is not evidence of a fault).
 */
export function actionableBootHealth(
  device: {
    boot_health: DeviceBootHealth | null;
    boot_checked_at: string | null;
  },
  now: number = Date.now(),
): DeviceBootHealth | null {
  const { boot_health: health, boot_checked_at: checkedAt } = device;
  if (!health || health === "healthy" || !KNOWN_VERDICTS.has(health)) return null;
  if (!checkedAt) return null;

  const checked = Date.parse(checkedAt);
  if (Number.isNaN(checked) || now - checked >= BOOT_VERDICT_SHELF_LIFE_MS) {
    return null;
  }
  return health;
}

/** What the operator would otherwise learn by clicking and waiting. */
export const BOOT_HEALTH_COPY: Record<
  DeviceBootHealth,
  { label: string; explanation: string }
> = {
  healthy: {
    label: "Boots",
    explanation: "Android comes up normally",
  },
  unstable: {
    label: "Unstable",
    explanation: "Android comes up but drops out — jobs may fail part-way",
  },
  dead: {
    label: "Won't boot",
    explanation: "Android never comes up — starting this device gives a black screen",
  },
};
