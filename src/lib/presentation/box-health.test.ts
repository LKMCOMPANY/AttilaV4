import { describe, expect, it } from "vitest";
import vocabulary from "./__fixtures__/box-health-vocabulary.json";
import {
  BOX_HEALTH_VERDICT_META,
  BOX_MAINTENANCE_META,
  BOX_STATUS_META,
  UNKNOWN_BOX_VALUE_TONE,
  boxHealthVerdictMeta,
  boxPresenceMeta,
} from "./box-health";
import { BOX_HEALTH_VERDICTS } from "@/lib/boxes/host-health";

/**
 * Shared with the macOS client through the JSON fixture (`BoxHealthPresentationTests`
 * on the Swift side asserts the same file). A label or tone changed here
 * without the fixture fails this test; changed in the fixture without Swift
 * fails theirs.
 */
describe("box health presentation vocabulary", () => {
  it("covers every verdict the presence writer can stamp, and nothing else", () => {
    expect(Object.keys(BOX_HEALTH_VERDICT_META).sort()).toEqual([...BOX_HEALTH_VERDICTS].sort());
    expect(Object.keys(vocabulary.verdicts).sort()).toEqual([...BOX_HEALTH_VERDICTS].sort());
    expect(BOX_HEALTH_VERDICT_META).toEqual(vocabulary.verdicts);
  });

  it("matches the shared fixture for statuses and the maintenance badge", () => {
    expect(BOX_STATUS_META).toEqual(vocabulary.statuses);
    expect(BOX_MAINTENANCE_META).toEqual(vocabulary.maintenance);
    expect(UNKNOWN_BOX_VALUE_TONE).toBe(vocabulary.unknownValue.tone);
  });

  it("reads a row without a verdict as unknown and humanises a newer value", () => {
    expect(boxHealthVerdictMeta(null)).toEqual(BOX_HEALTH_VERDICT_META.unknown);
    expect(boxHealthVerdictMeta(undefined)).toEqual(BOX_HEALTH_VERDICT_META.unknown);
    expect(boxHealthVerdictMeta("unhealthy")).toEqual(BOX_HEALTH_VERDICT_META.unhealthy);
    expect(boxHealthVerdictMeta("thermal_throttled")).toEqual({ label: "Thermal throttled", tone: "muted" });
  });

  it("lets an open maintenance window win over the stored status", () => {
    const now = new Date("2026-09-25T21:00:00Z");
    expect(boxPresenceMeta({ status: "online", maintenance_until: null }, now)).toEqual(BOX_STATUS_META.online);
    expect(boxPresenceMeta({ status: "offline", maintenance_until: "2026-09-25T22:00:00Z" }, now)).toEqual(BOX_MAINTENANCE_META);
    expect(boxPresenceMeta({ status: "offline", maintenance_until: "2026-09-25T20:00:00Z" }, now)).toEqual(BOX_STATUS_META.offline);
  });
});
