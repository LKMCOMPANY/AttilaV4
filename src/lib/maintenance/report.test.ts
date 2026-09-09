import { describe, expect, it } from "vitest";
import { TOO_REGULAR_THRESHOLD, regularitySpread } from "./report";

/**
 * The self-audit a bot detector would run on us: sessions that start at the
 * same minute every day read like a cron job, whatever their content.
 */
describe("session regularity", () => {
  it("has no verdict on fewer than two sessions", () => {
    expect(regularitySpread([])).toBeNull();
    expect(regularitySpread([600])).toBeNull();
  });

  it("flags a metronome and passes a human spread", () => {
    expect(regularitySpread([600, 600, 601])!).toBeLessThan(TOO_REGULAR_THRESHOLD);
    expect(regularitySpread([540, 780, 1260])!).toBeGreaterThan(0.3);
  });

  it("measures across midnight", () => {
    // 23:50 and 00:10 are twenty minutes apart, not 23 h 40.
    expect(regularitySpread([1430, 10])).toBeCloseTo(20 / 720, 3);
  });
});
