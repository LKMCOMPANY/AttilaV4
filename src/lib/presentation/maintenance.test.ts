import { describe, expect, it } from "vitest";
import vocabulary from "./__fixtures__/maintenance-vocabulary.json";
import {
  MODE_LABEL,
  ON_DEVICE_SHELF_LIFE_DAYS,
  ON_DEVICE_STATUS_META,
  PROFILE_LABEL,
  TASK_KIND_LABEL,
  TASK_STATUS_META,
  actionableOnDeviceStatus,
} from "./maintenance";
import {
  MAINTENANCE_MODES,
  MAINTENANCE_PROFILES,
  MAINTENANCE_TASK_KINDS,
  MAINTENANCE_TASK_STATUSES,
  ON_DEVICE_STATUSES,
} from "@/types";

describe("maintenance presentation vocabulary", () => {
  it("matches the shared fixture", () => {
    expect(Object.keys(ON_DEVICE_STATUS_META).sort()).toEqual([...ON_DEVICE_STATUSES].sort());
    expect(ON_DEVICE_STATUS_META).toEqual(vocabulary.onDeviceStatuses);
    expect(Object.keys(TASK_KIND_LABEL).sort()).toEqual([...MAINTENANCE_TASK_KINDS].sort());
    for (const kind of MAINTENANCE_TASK_KINDS) expect(TASK_KIND_LABEL[kind]).toBe(vocabulary.taskKinds[kind].label);
    expect(Object.keys(TASK_STATUS_META).sort()).toEqual([...MAINTENANCE_TASK_STATUSES].sort());
    expect(TASK_STATUS_META).toEqual(vocabulary.taskStatuses);
    for (const profile of MAINTENANCE_PROFILES) expect(PROFILE_LABEL[profile]).toBe(vocabulary.profiles[profile].label);
    for (const mode of MAINTENANCE_MODES) expect(MODE_LABEL[mode]).toBe(vocabulary.modes[mode].label);
    expect(ON_DEVICE_SHELF_LIFE_DAYS).toBe(vocabulary.onDeviceShelfLifeDays);
  });
});

/**
 * What the operator is warned about on the device side, and what they are
 * not — the twin of `actionableBootHealth`.
 */
describe("actionable on-device status", () => {
  const now = new Date("2026-09-09T12:00:00.000Z");

  it("shows a fresh problem", () => {
    expect(actionableOnDeviceStatus({ on_device_status: "logged_out", probed_at: "2026-09-09T08:00:00.000Z" }, now)).toBe("logged_out");
    expect(actionableOnDeviceStatus({ on_device_status: "app_outdated", probed_at: "2026-09-03T12:00:01.000Z" }, now)).toBe("app_outdated");
  });

  it("stays silent on a healthy or never-probed account", () => {
    expect(actionableOnDeviceStatus({ on_device_status: "logged_in", probed_at: "2026-09-09T08:00:00.000Z" }, now)).toBeNull();
    expect(actionableOnDeviceStatus({ on_device_status: "unknown", probed_at: "2026-09-09T08:00:00.000Z" }, now)).toBeNull();
    expect(actionableOnDeviceStatus({ on_device_status: "logged_out", probed_at: null }, now)).toBeNull();
    expect(actionableOnDeviceStatus(null, now)).toBeNull();
  });

  it("expires a stale verdict rather than misleading", () => {
    expect(actionableOnDeviceStatus({ on_device_status: "logged_out", probed_at: "2026-09-01T12:00:00.000Z" }, now)).toBeNull();
    expect(actionableOnDeviceStatus({ on_device_status: "logged_out", probed_at: "garbage" }, now)).toBeNull();
  });
});
