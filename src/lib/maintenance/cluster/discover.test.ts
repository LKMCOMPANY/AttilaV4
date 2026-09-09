import { describe, expect, it } from "vitest";
import { scoreCandidate } from "./discover";

/**
 * A cluster is made of accounts an avatar can plausibly sit next to: bigger
 * is better up to a point, the very largest are pushed back, and a creator
 * found on the first keyword edges out one found on the third.
 */
describe("cluster candidate score", () => {
  it("prefers bigger accounts and pushes the giants back", () => {
    expect(scoreCandidate(50_000, 0)).toBeGreaterThan(scoreCandidate(500, 0));
    expect(scoreCandidate(50_000_000, 0)).toBeLessThan(scoreCandidate(500_000, 0));
  });

  it("ranks the first keyword above the third at equal size", () => {
    expect(scoreCandidate(10_000, 0)).toBeGreaterThan(scoreCandidate(10_000, 2));
  });

  it("gives an unknown size the floor, not an error", () => {
    expect(scoreCandidate(null, 0)).toBe(0);
    expect(scoreCandidate(0, 1)).toBeLessThan(0);
  });
});
