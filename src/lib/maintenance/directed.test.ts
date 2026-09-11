import { describe, expect, it } from "vitest";
import { parseCompactTree } from "@/lib/engine/ui/compact-tree";
import { BOX_GAP_MS, directedParamsSchema, intoActiveHours, parseTarget, planDirectedSchedule } from "./directed";
import { mentionsHandle } from "./recipes/directed-action";

describe("directed actions — targets", () => {
  it("reads TikTok video and profile URLs", () => {
    expect(parseTarget("https://www.tiktok.com/@espn/video/7300000000000000000")).toEqual({
      platform: "tiktok",
      handle: "espn",
      kind: "post",
      profileUrl: "https://www.tiktok.com/@espn",
    });
    expect(parseTarget("https://www.tiktok.com/@natgeo")?.kind).toBe("profile");
    expect(parseTarget("https://vm.tiktok.com/ZMabc123/")).toEqual({ platform: "tiktok", handle: null, kind: "unknown", profileUrl: null });
  });

  it("reads X posts and profiles, on both hosts", () => {
    expect(parseTarget("https://x.com/nasa/status/1234567890")).toMatchObject({ platform: "twitter", handle: "nasa", kind: "post" });
    expect(parseTarget("https://twitter.com/nasa")).toMatchObject({ platform: "twitter", handle: "nasa", kind: "profile", profileUrl: "https://x.com/nasa" });
    expect(parseTarget("https://x.com/i/status/1")).toMatchObject({ handle: null, kind: "unknown" });
  });

  it("rejects what is not a platform URL", () => {
    expect(parseTarget("https://example.com/post/1")).toBeNull();
    expect(parseTarget("not a url")).toBeNull();
  });

  it("requires a text for a comment, and nothing else", () => {
    const base = { target_url: "https://www.tiktok.com/@a/video/1", request_id: crypto.randomUUID(), requested_by: crypto.randomUUID() };
    expect(directedParamsSchema.safeParse({ ...base, action: "like" }).success).toBe(true);
    expect(directedParamsSchema.safeParse({ ...base, action: "comment" }).success).toBe(false);
    expect(directedParamsSchema.safeParse({ ...base, action: "comment", text: "nice" }).success).toBe(true);
    expect(directedParamsSchema.safeParse({ ...base, action: "post" }).success).toBe(false);
  });

  it("finds the target's handle on the screen, case-insensitively", () => {
    const tree = parseCompactTree(`Screen 1080x2340 rotation=0
[0] android.widget.FrameLayout package="com.zhiliaoapp.musically" bounds=[0,0][1080,2340]
 [1] android.widget.Button text="ESPN" resource-id="com.zhiliaoapp.musically:id/title" package="com.zhiliaoapp.musically" clickable=true bounds=[40,1800][300,1860]
 [2] android.widget.TextView text="Highlights of the night" package="com.zhiliaoapp.musically" bounds=[40,1900][900,1960]`);
    expect(mentionsHandle(tree, "espn")).toBe(true);
    expect(mentionsHandle(tree, "natgeo")).toBe(false);
  });
});

describe("directed actions — the fan-out schedule", () => {
  const hours = { start: 8, end: 23 };
  // Noon in Paris: inside the window.
  const noon = new Date("2026-09-11T10:00:00.000Z");
  const seq = (values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
  };

  it("runs a single avatar immediately", () => {
    const plan = planDirectedSchedule([{ avatarId: "a", boxId: "b1", timezone: "Europe/Paris" }], { spreadHours: 4, activeHours: hours, now: noon, random: seq([0.9]) });
    expect(plan).toHaveLength(1);
    expect(plan[0].scheduledFor.getTime()).toBe(noon.getTime());
    expect(plan[0].adjusted).toBe(false);
  });

  it("spreads an army over the window and keeps one box's avatars apart", () => {
    const candidates = [
      { avatarId: "a", boxId: "b1", timezone: "Europe/Paris" },
      { avatarId: "b", boxId: "b1", timezone: "Europe/Paris" },
      { avatarId: "c", boxId: "b2", timezone: "Europe/Paris" },
    ];
    // Two orders of box b1 drawn on the very same instant, the third elsewhere.
    const plan = planDirectedSchedule(candidates, { spreadHours: 2, activeHours: hours, now: noon, random: seq([0.5, 0.5, 0.1, 0]) });
    const byAvatar = Object.fromEntries(plan.map((p) => [p.avatarId, p]));
    const gap = Math.abs(byAvatar.a.scheduledFor.getTime() - byAvatar.b.scheduledFor.getTime());
    expect(gap).toBeGreaterThanOrEqual(BOX_GAP_MS);
    expect(byAvatar.a.adjusted || byAvatar.b.adjusted).toBe(true);
    for (const order of plan) {
      expect(order.scheduledFor.getTime()).toBeGreaterThanOrEqual(noon.getTime());
      expect(order.scheduledFor.getTime()).toBeLessThan(noon.getTime() + 2 * 3_600_000 + BOX_GAP_MS + 30_000);
    }
  });

  it("waits for the device's active hours, in its own time zone", () => {
    // 03:00 in Paris — the window opens at 08:00 local.
    const night = new Date("2026-09-11T01:00:00.000Z");
    const moved = intoActiveHours(night, "Europe/Paris", hours, () => 0);
    expect(moved.toISOString()).toBe("2026-09-11T06:00:00.000Z");
    // 23:30 in Paris — tomorrow's opening.
    const late = new Date("2026-09-11T21:30:00.000Z");
    expect(intoActiveHours(late, "Europe/Paris", hours, () => 0).toISOString()).toBe("2026-09-12T06:00:00.000Z");
    // Inside the window: untouched.
    expect(intoActiveHours(noon, "Europe/Paris", hours, () => 0).getTime()).toBe(noon.getTime());
    // An unknown zone falls back to UTC instead of failing.
    expect(intoActiveHours(noon, "Mars/Olympus", hours, () => 0).getTime()).toBe(noon.getTime());
  });
});
