import { describe, expect, it } from "vitest";
import { parseDumpsysPackage } from "./packages";

/**
 * The guest shell is the fallback when the host cannot reach the v2 agent;
 * `dumpsys package` is what it answers with. "Not installed" must come from an
 * answer, never from silence.
 */
describe("dumpsys package parsing", () => {
  it("reads the build of an installed package", () => {
    const parsed = parseDumpsysPackage(
      "    versionCode=311860000 minSdk=23 targetSdk=34\n    versionName=11.86.0-release.0\n",
    );
    expect(parsed).toEqual({ versionName: "11.86.0-release.0", versionCode: 311860000, found: true });
  });

  it("recognises an absent package from an empty answer", () => {
    expect(parseDumpsysPackage("")).toEqual({ versionName: null, versionCode: null, found: false });
    expect(parseDumpsysPackage("Unable to find package: com.example\n").found).toBe(false);
  });
});
