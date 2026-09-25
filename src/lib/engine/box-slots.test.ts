import { describe, expect, it } from "vitest";
import { DEFAULT_HEALTH_THRESHOLDS } from "@/lib/boxes/host-health";
import { decideSlot, type LiveOccupancy, type SlotInput } from "./box-slots";

const box = { id: "b", tunnel_hostname: "box-2.attila.army", max_concurrent_containers: 10, operator_reserve: 1 };

function live(over: Partial<LiveOccupancy> = {}): LiveOccupancy {
  return { running: 0, starting: 0, occupied: [], uptimeSeconds: 100_000, host: null, ...over };
}

function input(over: Partial<SlotInput> = {}): SlotInput {
  return {
    box,
    dbId: "EDGEX",
    purpose: "maintenance",
    live: live(),
    campaignDue: false,
    startsInFlight: 0,
    thresholds: DEFAULT_HEALTH_THRESHOLDS,
    now: new Date("2026-09-25T20:00:00Z"),
    ...over,
  };
}

describe("decideSlot", () => {
  it("refuses when the box cannot be read", () => {
    expect(decideSlot(input({ live: null })).reason).toBe("box_unreachable");
  });

  it("grants a container that is already up, whatever else is going on", () => {
    const d = decideSlot(input({ live: live({ running: 10, occupied: ["EDGEX"], host: { cpu_percent: 99, mem_percent: 99, swap_percent: 99 } }) }));
    expect(d).toMatchObject({ granted: true, reason: "already_running" });
  });

  it("refuses box_maintenance while the window is open, for every purpose", () => {
    const until = "2026-09-25T21:00:00Z";
    for (const purpose of ["campaign", "maintenance", "operator"] as const) {
      const d = decideSlot(input({ purpose, box: { ...box, maintenance_until: until } }));
      expect(d.reason).toBe("box_maintenance");
      expect(d.detail).toBe(until);
    }
    // A window in the past is no window.
    expect(decideSlot(input({ box: { ...box, maintenance_until: "2026-09-25T19:00:00Z" } })).granted).toBe(true);
  });

  it("refuses box_unhealthy above a threshold and names the one that tripped", () => {
    const d = decideSlot(input({ live: live({ host: { cpu_percent: 40, mem_percent: 50, swap_percent: 74 } }) }));
    expect(d.reason).toBe("box_unhealthy");
    expect(d.detail).toBe("swap 74% > 60%");
    // The persisted sample stands in when the live one is missing.
    const persisted = decideSlot(input({ box: { ...box, host_health: { cpu_percent: 95, mem_percent: 10, swap_percent: 0, mmc_percent: null, ssd_percent: null, running: 3, starting: 0, sampled_at: "x" } } }));
    expect(persisted.reason).toBe("box_unhealthy");
    // Nulls are unknowns, not trips.
    expect(decideSlot(input({ live: live({ host: { cpu_percent: null, mem_percent: null, swap_percent: null } }) })).granted).toBe(true);
  });

  it("refuses box_settling only while young AND storming", () => {
    expect(decideSlot(input({ live: live({ uptimeSeconds: 120, starting: 3 }) })).reason).toBe("box_settling");
    expect(decideSlot(input({ live: live({ uptimeSeconds: 120, starting: 2 }) })).granted).toBe(true);
    expect(decideSlot(input({ live: live({ uptimeSeconds: 900, starting: 5 }) })).reason).not.toBe("box_settling");
  });

  it("counts starting containers as occupied and keeps the operator reserve for operators", () => {
    expect(decideSlot(input({ live: live({ running: 8, starting: 2 }) })).reason).toBe("box_full");
    // 9 occupied: automation stops (reserve), an operator may still start.
    expect(decideSlot(input({ live: live({ running: 9 }) })).reason).toBe("operator_reserve");
    expect(decideSlot(input({ purpose: "campaign", live: live({ running: 9 }) })).reason).toBe("operator_reserve");
    expect(decideSlot(input({ purpose: "operator", live: live({ running: 9 }) })).granted).toBe(true);
  });

  it("lets a due campaign job pre-empt maintenance, and bounds boots in flight", () => {
    expect(decideSlot(input({ campaignDue: true })).reason).toBe("campaign_priority");
    expect(decideSlot(input({ purpose: "campaign", campaignDue: true })).granted).toBe(true);
    expect(decideSlot(input({ startsInFlight: 2 })).reason).toBe("starts_in_flight");
  });

  it("uses the arbiter's default capacity (10 / 1) when the row carries nulls", () => {
    const d = decideSlot(input({ box: { ...box, max_concurrent_containers: null, operator_reserve: null }, live: live({ running: 9 }) }));
    expect(d.automationCapacity).toBe(9);
    expect(d.reason).toBe("operator_reserve");
  });
});
