import { describe, expect, it } from "vitest";
import { parseCompactTree } from "@/lib/engine/ui/compact-tree";
import { buildVisionPrompt, clickableLabels, decisionSchema, isLooping, pickClickTarget } from "./vision-agent";

const SCREEN = parseCompactTree(`
[0] android.widget.FrameLayout package="com.zhiliaoapp.musically" bounds=[0,0][1080,2340]
  [0] android.widget.TextView text="Turn on notifications?" package="com.zhiliaoapp.musically" enabled=true bounds=[96,900][984,1000]
  [1] android.widget.Button text="Allow" package="com.zhiliaoapp.musically" clickable=true enabled=true bounds=[96,1200][984,1300]
  [2] android.widget.Button text="Not now" package="com.zhiliaoapp.musically" clickable=true enabled=true bounds=[96,1320][984,1420]
  [3] android.widget.Button text="Log in" package="com.zhiliaoapp.musically" clickable=true enabled=true bounds=[96,1440][984,1540]
  [4] android.widget.ImageView content-desc="Close" package="com.zhiliaoapp.musically" clickable=true enabled=true bounds=[960,60][1060,160]
`);

/**
 * The agent's safety is not in the model: it is in what the code lets the
 * model do. These are the guards, tested without a model or a device.
 */
describe("bounded vision agent", () => {
  it("clicks only visible labels that are not forbidden", () => {
    expect(pickClickTarget(SCREEN, "Not now")?.text).toBe("Not now");
    expect(pickClickTarget(SCREEN, "close")?.contentDesc).toBe("Close");
    expect(pickClickTarget(SCREEN, "Allow")).toBeNull();
    expect(pickClickTarget(SCREEN, "Log in")).toBeNull();
    expect(pickClickTarget(SCREEN, "Something not on screen")).toBeNull();
    expect(pickClickTarget(SCREEN, undefined)).toBeNull();
  });

  it("offers the model only the safe labels", () => {
    expect(clickableLabels(SCREEN)).toEqual(["Not now", "Close"]);
  });

  it("detects a screen that stopped moving", () => {
    expect(isLooping(["a", "b", "b"])).toBe(false);
    expect(isLooping(["a", "b", "b", "b"])).toBe(true);
    expect(isLooping(["b", "b"])).toBe(false);
  });

  it("validates the model's answer strictly", () => {
    expect(decisionSchema.safeParse({ action: "click", label: "Not now", reason: "dismiss" }).success).toBe(true);
    expect(decisionSchema.safeParse({ action: "type", reason: "x" }).success).toBe(false);
    expect(decisionSchema.safeParse({ action: "back" }).success).toBe(false);
  });

  it("tells the model the rules and the moves so far", () => {
    const prompt = buildVisionPrompt("tiktok", ["Not now"], [
      { step: 1, decision: { action: "back", reason: "sheet" }, applied: true, screenState: "unknown" },
    ]);
    expect(prompt).toContain("never accept, allow, log in");
    expect(prompt).toContain('"Not now"');
    expect(prompt).toContain("1:back→unknown");
  });
});
