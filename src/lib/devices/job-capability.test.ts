import { describe, expect, it } from "vitest";

import { BOOT_VERDICT_SHELF_LIFE_MS } from "./boot-health";
import { deviceIncapability, type JobCapabilityFacts } from "./job-capability";

/**
 * The rule every selector applies before handing a device a job. What it
 * refuses matters; what it lets through when nothing was measured matters as
 * much — an unaudited fleet must not read as an incapable one.
 */
describe("deviceIncapability", () => {
  const now = Date.parse("2026-09-26T18:00:00.000Z");
  const stamp = (msAgo: number) => new Date(now - msAgo).toISOString();
  const facts = (over: Partial<JobCapabilityFacts> = {}): JobCapabilityFacts => ({
    boot_health: "healthy",
    boot_checked_at: stamp(3_600_000),
    adbkeyboard_installed: true,
    tiktok_installed: true,
    twitter_installed: true,
    ...over,
  });

  it("lets a healthy, fully provisioned device through", () => {
    expect(deviceIncapability(facts(), "tiktok", now)).toBeNull();
    expect(deviceIncapability(facts(), "twitter", now)).toBeNull();
  });

  it("never-audited columns are not evidence of a fault", () => {
    const unknown = facts({
      boot_health: null,
      boot_checked_at: null,
      adbkeyboard_installed: null,
      tiktok_installed: null,
      twitter_installed: null,
    });
    expect(deviceIncapability(unknown, "tiktok", now)).toBeNull();
  });

  it("refuses a device the sweep found dead, while the verdict is recent", () => {
    expect(deviceIncapability(facts({ boot_health: "dead", boot_checked_at: stamp(86_400_000) }), "tiktok", now)).toBe("boot_dead");
  });

  it("forgets a dead verdict past its shelf life — same rule as the badge", () => {
    const stale = facts({ boot_health: "dead", boot_checked_at: stamp(BOOT_VERDICT_SHELF_LIFE_MS + 1) });
    expect(deviceIncapability(stale, "tiktok", now)).toBeNull();
  });

  it("an unstable device is allowed to try", () => {
    expect(deviceIncapability(facts({ boot_health: "unstable", boot_checked_at: stamp(60_000) }), "twitter", now)).toBeNull();
  });

  it("refuses a device without the IME, whatever the platform", () => {
    expect(deviceIncapability(facts({ adbkeyboard_installed: false }), "tiktok", now)).toBe("ime_missing");
    expect(deviceIncapability(facts({ adbkeyboard_installed: false }), "twitter", now)).toBe("ime_missing");
  });

  it("refuses only the platform whose app is missing", () => {
    const noTikTok = facts({ tiktok_installed: false });
    expect(deviceIncapability(noTikTok, "tiktok", now)).toBe("app_missing");
    expect(deviceIncapability(noTikTok, "twitter", now)).toBeNull();
  });

  it("a platform without a package flag is judged on boot and IME only", () => {
    expect(deviceIncapability(facts({ tiktok_installed: false, twitter_installed: false }), "reddit", now)).toBeNull();
  });

  it("reports the boot verdict before the software — one cannot install on a phone that does not start", () => {
    const dead = facts({ boot_health: "dead", boot_checked_at: stamp(60_000), adbkeyboard_installed: false });
    expect(deviceIncapability(dead, "tiktok", now)).toBe("boot_dead");
  });
});
