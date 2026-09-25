import { describe, expect, it } from "vitest";
import { DEFAULT_HEALTH_THRESHOLDS, assessHostHealth } from "./host-health";

describe("assessHostHealth", () => {
  it("is unknown without a sample or without any gauge", () => {
    expect(assessHostHealth(null, DEFAULT_HEALTH_THRESHOLDS)).toEqual({ verdict: "unknown", over: [] });
    expect(assessHostHealth({ cpu_percent: null, mem_percent: null, swap_percent: null }, DEFAULT_HEALTH_THRESHOLDS)).toEqual({ verdict: "unknown", over: [] });
  });

  it("is ok at the thresholds and names every gauge over them", () => {
    expect(assessHostHealth({ cpu_percent: 90, mem_percent: 92, swap_percent: 60 }, DEFAULT_HEALTH_THRESHOLDS)).toEqual({ verdict: "ok", over: [] });
    // box-1 after the move (25 Sep 2026): load 192, zram full.
    expect(assessHostHealth({ cpu_percent: 99.2, mem_percent: 61, swap_percent: 100 }, DEFAULT_HEALTH_THRESHOLDS)).toEqual({
      verdict: "unhealthy",
      over: ["cpu 99.2% > 90%", "swap 100% > 60%"],
    });
  });

  it("reads a partial sample with the gauges it has", () => {
    expect(assessHostHealth({ cpu_percent: 12, mem_percent: null, swap_percent: null }, DEFAULT_HEALTH_THRESHOLDS).verdict).toBe("ok");
    expect(assessHostHealth({ cpu_percent: null, mem_percent: 95, swap_percent: null }, DEFAULT_HEALTH_THRESHOLDS)).toEqual({ verdict: "unhealthy", over: ["mem 95% > 92%"] });
  });
});
