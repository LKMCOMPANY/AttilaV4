import { describe, expect, it } from "vitest";
import vocabulary from "./__fixtures__/slot-refusal-vocabulary.json";
import { SLOT_REFUSAL_META, UNKNOWN_REFUSAL_TONE, slotRefusalMeta } from "./slot-refusal";
import { SLOT_REFUSALS } from "@/lib/engine/box-slots";

/**
 * Shared with the macOS client through the JSON fixture (`SlotRefusalPresentationTests`
 * on the Swift side asserts the same file).
 */
describe("slot refusal presentation vocabulary", () => {
  it("covers every refusal the arbiter can return, and nothing else", () => {
    expect(Object.keys(SLOT_REFUSAL_META).sort()).toEqual([...SLOT_REFUSALS].sort());
    expect(Object.keys(vocabulary.refusals).sort()).toEqual([...SLOT_REFUSALS].sort());
  });

  it("matches the shared fixture", () => {
    expect(SLOT_REFUSAL_META).toEqual(vocabulary.refusals);
    expect(UNKNOWN_REFUSAL_TONE).toBe(vocabulary.unknownRefusal.tone);
  });

  it("degrades an unknown refusal to a humanised muted label", () => {
    expect(slotRefusalMeta("box_unhealthy")).toEqual(SLOT_REFUSAL_META.box_unhealthy);
    expect(slotRefusalMeta("thermal_limit")).toEqual({ label: "Thermal limit", tone: "muted" });
    expect(slotRefusalMeta("")).toEqual({ label: "Start refused", tone: "muted" });
  });
});
