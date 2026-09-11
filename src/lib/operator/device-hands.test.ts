import { describe, expect, it } from "vitest";
import { parseCompactTree } from "@/lib/engine/ui/compact-tree";
import { deviceInputSchema, isHandsOff, selectorFor, swipeGesture } from "./device-input";
import { classifyForOperator, compactNodes, socialAppOf } from "./device-screen";

const TIKTOK_FEED = `Screen 1080x2340 rotation=0
[0] android.widget.FrameLayout package="com.zhiliaoapp.musically" bounds=[0,0][1080,2340]
 [1] android.widget.TextView text="For You" package="com.zhiliaoapp.musically" clickable=true selected=true bounds=[400,100][680,160]
 [2] android.widget.ImageView content-desc="Like video. 941 likes" resource-id="com.zhiliaoapp.musically:id/fn3" package="com.zhiliaoapp.musically" clickable=true bounds=[960,1400][1060,1500]
 [3] android.widget.ImageView content-desc="Read or add comments. 12 comments" package="com.zhiliaoapp.musically" clickable=true bounds=[960,1520][1060,1620]
 [4] android.widget.EditText text="" hint="Add comment..." resource-id="com.zhiliaoapp.musically:id/e07" package="com.zhiliaoapp.musically" focusable=true bounds=[0,2200][900,2300]
 [5] android.view.View package="com.zhiliaoapp.musically" bounds=[0,0][0,0]`;

describe("device-screen — the operator's eyes", () => {
  it("names the social app on top from the packages", () => {
    expect(socialAppOf(["com.zhiliaoapp.musically", "com.android.systemui"])).toBe("tiktok");
    expect(socialAppOf(["com.twitter.android"])).toBe("twitter");
    expect(socialAppOf(["com.android.settings"])).toBeNull();
  });

  it("classifies with the engine's taxonomy when a social app is on top", () => {
    const tree = parseCompactTree(TIKTOK_FEED);
    const classification = classifyForOperator(tree);
    expect(classification.app).toBe("tiktok");
    expect(classification.topPackage).toBe("com.zhiliaoapp.musically");
    expect(classification.state).not.toBe("empty_tree");
  });

  it("answers unknown, not a guess, without a social app", () => {
    const tree = parseCompactTree(`Screen 1080x2340 rotation=0
[0] android.widget.FrameLayout package="com.android.settings" bounds=[0,0][1080,2340]
 [1] android.widget.TextView text="Settings" package="com.android.settings" bounds=[0,0][500,100]`);
    const classification = classifyForOperator(tree);
    expect(classification.app).toBeNull();
    expect(classification.state).toBe("unknown");
    expect(classification.evidence).toContain("com.android.settings");
  });

  it("compacts the tree to actionable nodes with centres, capped", () => {
    const tree = parseCompactTree(TIKTOK_FEED);
    const nodes = compactNodes(tree, 3);
    expect(nodes).toHaveLength(3);
    const like = compactNodes(tree).find((n) => n.resource_id === "com.zhiliaoapp.musically:id/fn3");
    expect(like?.center).toEqual([1010, 1450]);
    expect(like?.clickable).toBe(true);
    const field = compactNodes(tree).find((n) => n.editable);
    expect(field?.resource_id).toBe("com.zhiliaoapp.musically:id/e07");
    // The bare layout node carries nothing a hand can use.
    expect(compactNodes(tree).some((n) => n.index === 5)).toBe(false);
  });
});

describe("device-input — the operator's hands", () => {
  it("validates gestures at the boundary", () => {
    expect(deviceInputSchema.safeParse({ action: "tap", x: 10, y: 20 }).success).toBe(true);
    expect(deviceInputSchema.safeParse({ action: "press", key: "back" }).success).toBe(true);
    expect(deviceInputSchema.safeParse({ action: "press", key: "power" }).success).toBe(false);
    expect(deviceInputSchema.safeParse({ action: "type", text: "" }).success).toBe(false);
    expect(deviceInputSchema.safeParse({ action: "open_url", url: "not a url" }).success).toBe(false);
    expect(deviceInputSchema.safeParse({ action: "swipe", direction: "up" }).success).toBe(true);
    expect(deviceInputSchema.safeParse({ action: "shell", cmd: "rm -rf /" }).success).toBe(false);
  });

  it("builds the engine's xpath dialect for named taps", () => {
    expect(selectorFor({ action: "tap", resource_id: "com.x:id/like" })).toEqual({ xpath: `//*[@resource-id="com.x:id/like"]` });
    expect(selectorFor({ action: "tap", content_desc: "Like video" })).toEqual({ xpath: `//*[contains(@content-desc,"Like video")]` });
    expect(selectorFor({ action: "tap", x: 1, y: 2 })).toBeNull();
  });

  it("keeps hands off a security check only", () => {
    expect(isHandsOff("bouncer")).toBe(true);
    expect(isHandsOff("logged_out")).toBe(false);
    expect(isHandsOff("feed_ok")).toBe(false);
  });

  it("sizes swipes from the screen, in the right direction", () => {
    const up = swipeGesture("up", 1080, 2340);
    expect(up.endY).toBeLessThan(up.startY);
    const right = swipeGesture("right", 1080, 2340);
    expect(right.endX).toBeGreaterThan(right.startX);
    const fallback = swipeGesture("down", 0, 0);
    expect(fallback.endY).toBeGreaterThan(fallback.startY);
  });
});
