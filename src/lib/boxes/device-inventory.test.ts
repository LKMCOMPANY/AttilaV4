import { describe, expect, it } from "vitest";
import { planInventory } from "./device-inventory";
import type { VmosContainer } from "@/lib/box-api";

const rows = [
  { id: "1", db_id: "RUNS", state: "stopped", account_id: null },
  { id: "2", db_id: "BOOTS", state: "stopped", account_id: "acc" },
  { id: "3", db_id: "IDLE", state: "running", account_id: null },
  { id: "4", db_id: "GONE", state: "stopped", account_id: null },
  { id: "5", db_id: "GHOST", state: "removed", account_id: null },
  { id: "6", db_id: "BACK", state: "removed", account_id: null },
  { id: "7", db_id: "SAME", state: "stopped", account_id: null },
];
const list = [
  { db_id: "RUNS", state: "running" },
  { db_id: "BOOTS", state: "starting" },
  { db_id: "IDLE", state: "stopped" },
  { db_id: "BACK", state: "stopped" },
  { db_id: "SAME", state: "stopped" },
  { db_id: "NEW", state: "stopped" },
] as unknown as VmosContainer[];

describe("planInventory", () => {
  it("maps the box's list onto the rows: running, stopped, removed, restored, unknown", () => {
    const { changes, unknownOnBox } = planInventory(rows, list);
    expect(changes).toEqual([
      { id: "1", to: "running", account_id: null },
      { id: "2", to: "running", account_id: "acc" },
      { id: "3", to: "stopped", account_id: null },
      { id: "4", to: "removed", account_id: null },
      { id: "6", to: "restored", account_id: null },
    ]);
    expect(unknownOnBox).toEqual(["NEW"]);
  });

  it("leaves an already-removed ghost and an unchanged row alone", () => {
    const { changes, removalsSuspended } = planInventory(rows, list);
    expect(changes.find((c) => c.id === "5")).toBeUndefined();
    expect(changes.find((c) => c.id === "7")).toBeUndefined();
    expect(removalsSuspended).toBe(false);
  });

  it("never removes a whole box on an empty or truncated list", () => {
    // cbs_go answering an empty list while 6 rows are active is a failed read, not a wipe.
    const empty = planInventory(rows, []);
    expect(empty.removalsSuspended).toBe(true);
    expect(empty.changes.filter((c) => c.to === "removed")).toEqual([]);
    // IDLE was running and is now unlisted: the stop is not a removal, it waits too.
    expect(empty.changes).toEqual([]);

    // Two of six active rows listed (33 %): still not trusted for removals…
    const truncated = planInventory(rows, list.slice(0, 2));
    expect(truncated.removalsSuspended).toBe(true);
    expect(truncated.changes.map((c) => c.to)).toEqual(["running", "running"]);

    // …three of six (50 %) is the floor: removals resume.
    const half = planInventory(rows, list.slice(0, 3));
    expect(half.removalsSuspended).toBe(false);
    expect(half.changes.filter((c) => c.to === "removed").length).toBeGreaterThan(0);
  });

  it("a box with no rows at all has nothing to suspend", () => {
    expect(planInventory([], [])).toEqual({ changes: [], unknownOnBox: [], removalsSuspended: false });
  });
});
