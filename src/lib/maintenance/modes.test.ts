import { describe, expect, it } from "vitest";
import { MAINTENANCE_MODES, MAINTENANCE_TASK_KINDS } from "@/types";
import { MODE_GRANTS, engagementAllowedIn, modeAllows, withheldOutcome } from "./modes";

describe("maintenance modes", () => {
  it("observe only reads: probes and checks run, sessions and re-logins are withheld", () => {
    for (const kind of ["probe", "app_check", "coherence", "dismiss_dialogs", "warmup"] as const) {
      expect(modeAllows("observe", kind)).toBe(true);
    }
    expect(modeAllows("observe", "social_session")).toBe(false);
    expect(modeAllows("observe", "relogin")).toBe(false);
    expect(engagementAllowedIn("observe")).toBe(false);
  });

  it("supervised runs the passive session but does nothing to the account", () => {
    expect(modeAllows("supervised", "social_session")).toBe(true);
    expect(modeAllows("supervised", "relogin")).toBe(false);
    expect(engagementAllowedIn("supervised")).toBe(false);
  });

  it("autonomous runs everything, engagement included", () => {
    for (const kind of MAINTENANCE_TASK_KINDS) expect(modeAllows("autonomous", kind)).toBe(true);
    expect(engagementAllowedIn("autonomous")).toBe(true);
  });

  it("each rung of the ladder grants at least what the one below it does", () => {
    const [observe, supervised, autonomous] = MAINTENANCE_MODES.map((m) => MODE_GRANTS[m].kinds);
    for (const kind of observe) expect(supervised).toContain(kind);
    for (const kind of supervised) expect(autonomous).toContain(kind);
  });

  it("names the withheld outcome after the mode", () => {
    expect(withheldOutcome("observe")).toBe("observe_mode");
    expect(withheldOutcome("supervised")).toBe("supervised_mode");
  });
});
