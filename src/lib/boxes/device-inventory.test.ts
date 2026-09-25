import { describe, expect, it } from "vitest";
import { planInventory } from "./device-inventory";

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
] as never;

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
    const { changes } = planInventory(rows, list);
    expect(changes.find((c) => c.id === "5")).toBeUndefined();
    expect(changes.find((c) => c.id === "7")).toBeUndefined();
  });
});
