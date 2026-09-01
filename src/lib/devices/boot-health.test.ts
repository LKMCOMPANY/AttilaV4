import { describe, expect, it } from "vitest";

import { actionableBootHealth, BOOT_VERDICT_SHELF_LIFE_MS } from "./boot-health";

/**
 * What the operator is warned about, and — just as important — what they are
 * not. A badge that cries wolf is a badge that gets ignored, and the next dead
 * device goes unnoticed.
 */
describe("actionableBootHealth", () => {
  const now = Date.parse("2026-09-01T10:00:00.000Z");
  const stamp = (msAgo: number) => new Date(now - msAgo).toISOString();

  it("acts on a recent dead verdict", () => {
    expect(
      actionableBootHealth(
        { boot_health: "dead", boot_checked_at: stamp(60_000) },
        now,
      ),
    ).toBe("dead");
  });

  it("acts on a recent unstable verdict", () => {
    expect(
      actionableBootHealth(
        { boot_health: "unstable", boot_checked_at: stamp(60_000) },
        now,
      ),
    ).toBe("unstable");
  });

  // Healthy is the expected case: saying so on 435 of 445 rows is noise.
  it("says nothing about a healthy device", () => {
    expect(
      actionableBootHealth(
        { boot_health: "healthy", boot_checked_at: stamp(60_000) },
        now,
      ),
    ).toBeNull();
  });

  // A container that failed a month ago may well have been fixed by a host
  // maintenance pass since.
  it("expires a stale verdict rather than misleading", () => {
    expect(
      actionableBootHealth(
        { boot_health: "dead", boot_checked_at: stamp(BOOT_VERDICT_SHELF_LIFE_MS + 60_000) },
        now,
      ),
    ).toBeNull();
  });

  it("still counts a verdict just inside the shelf life", () => {
    expect(
      actionableBootHealth(
        { boot_health: "dead", boot_checked_at: stamp(BOOT_VERDICT_SHELF_LIFE_MS - 60_000) },
        now,
      ),
    ).toBe("dead");
  });

  // Never probed is not the same as unhealthy — 55 devices are in this state
  // and none of them has been shown to be broken.
  it("says nothing about a device that was never probed", () => {
    expect(
      actionableBootHealth({ boot_health: null, boot_checked_at: null }, now),
    ).toBeNull();
  });

  // A verdict with no timestamp cannot be aged, so it cannot be trusted.
  it("says nothing about an undated verdict", () => {
    expect(
      actionableBootHealth({ boot_health: "dead", boot_checked_at: null }, now),
    ).toBeNull();
  });

  it("says nothing about an unparseable timestamp", () => {
    expect(
      actionableBootHealth(
        { boot_health: "dead", boot_checked_at: "not a date" },
        now,
      ),
    ).toBeNull();
  });

  // The column is free text server-side; an unknown value is not evidence of
  // a fault, so it must not raise a badge.
  it("says nothing about a verdict it does not recognise", () => {
    expect(
      actionableBootHealth(
        {
          boot_health: "banana" as never,
          boot_checked_at: stamp(60_000),
        },
        now,
      ),
    ).toBeNull();
  });
});
