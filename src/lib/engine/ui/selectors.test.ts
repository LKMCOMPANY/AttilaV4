import { describe, expect, it } from "vitest";

import { parseCompactTree } from "./compact-tree";
import { matchNodes, resolveCandidates, resolveInTree, toV2Selector, xpathString } from "./selectors";

const TT = "com.zhiliaoapp.musically";
const FEED_45_9_3 = parseCompactTree(
  [
    "Screen 1080x2340 rotation=0",
    `[0] android.widget.FrameLayout resource-id="android:id/content" package="${TT}" enabled=true bounds=[0,0][1080,2340]`,
    `  [0] android.widget.Button resource-id="${TT}:id/fsv" package="${TT}" content-desc="Like video 2.2M likes" clickable=true enabled=true bounds=[888,1287][1080,1467]`,
    `  [1] android.widget.Button resource-id="${TT}:id/e8n" package="${TT}" content-desc="Read or add comments. 13.8K comments" clickable=true enabled=true bounds=[888,1467][1080,1647]`,
    `  [2] android.widget.ImageView resource-id="${TT}:id/jpk" package="${TT}" content-desc="Search" clickable=true enabled=true bounds=[912,75][1080,243]`,
    `  [3] android.widget.EditText text="Search" resource-id="${TT}:id/hc0" package="${TT}" clickable=true enabled=true focusable=true bounds=[120,90][960,200]`,
    `  [4] android.widget.EditText text="" resource-id="${TT}:id/zzz" package="${TT}" clickable=true enabled=true focusable=true focused=true bounds=[0,0][10,10]`,
  ].join("\n"),
);

describe("resolveCandidates", () => {
  it("orders description matchers before versioned resource ids", () => {
    const cands = resolveCandidates("tiktok.like_button", { versionCode: 2024509030, locale: "en-GB" });
    expect(cands[0].matcher).toEqual({ by: "desc_contains", value: "Like video" });
    expect(cands.some((c) => c.matcher.by === "resource_id" && c.matcher.value.endsWith("fsv"))).toBe(true);
    // The 45.0.3 id must not be offered on a 45.9.3 build.
    expect(cands.some((c) => c.matcher.by === "resource_id" && c.matcher.value.endsWith("fn3"))).toBe(false);
  });

  it("drops versioned ids when the build is unknown", () => {
    const cands = resolveCandidates("tiktok.like_button", { versionCode: null, locale: "en" });
    expect(cands.every((c) => c.matcher.by !== "resource_id")).toBe(true);
  });

  it("keeps only the device language when it is known, every language when it is not", () => {
    const fr = resolveCandidates("tiktok.comments_button", { locale: "fr-FR" }).map((c) => c.matcher);
    expect(fr).toEqual([{ by: "desc_contains", value: "commentaires" }]);
    const unknown = resolveCandidates("tiktok.comments_button", { locale: null });
    expect(unknown).toHaveLength(3);
    expect(unknown[0].matcher).toEqual({ by: "desc_contains", value: "comments" });
  });

  it("lets table rows compete on priority", () => {
    const cands = resolveCandidates("tiktok.send_button", { versionCode: 2024509030 }, [
      { matcher: { by: "resource_id", value: `${TT}:id/new` }, versionMin: 2024509030, priority: 5 },
    ]);
    expect(cands[0].matcher).toEqual({ by: "resource_id", value: `${TT}:id/new` });
  });
});

describe("matchNodes / resolveInTree", () => {
  it("matches by description substring, exact text and resource id", () => {
    expect(matchNodes(FEED_45_9_3, { by: "desc_contains", value: "like video" })).toHaveLength(1);
    expect(matchNodes(FEED_45_9_3, { by: "text", value: "Search" })).toHaveLength(1);
    expect(matchNodes(FEED_45_9_3, { by: "resource_id", value: `${TT}:id/jpk` })).toHaveLength(1);
  });

  it("prefers the focused EditText, else the largest", () => {
    const [focused] = matchNodes(FEED_45_9_3, { by: "edit_text" });
    expect(focused.resourceId).toBe(`${TT}:id/zzz`);
  });

  it("resolves a key against the tree without a device round-trip", () => {
    const target = resolveInTree("tiktok.like_button", FEED_45_9_3, { versionCode: 2024509030, locale: "en-GB" });
    expect(target?.node.resourceId).toBe(`${TT}:id/fsv`);
    expect(target?.selector).toEqual({ xpath: '//*[contains(@content-desc,"Like video")]' });
  });

  it("returns null when the target is not on screen", () => {
    expect(resolveInTree("tiktok.follow_button", FEED_45_9_3, { locale: "en" })).toBeNull();
  });
});

describe("toV2Selector / xpathString", () => {
  it("emits contains() for descriptions and exact predicates for text and ids", () => {
    const node = FEED_45_9_3.nodes[1];
    expect(toV2Selector({ by: "desc_contains", value: "comments" }, node)).toEqual({ xpath: '//*[contains(@content-desc,"comments")]' });
    expect(toV2Selector({ by: "text", value: "Follow" }, node)).toEqual({ xpath: '//*[@text="Follow"]' });
    expect(toV2Selector({ by: "resource_id", value: "post-detail-reply-text-field" }, node)).toEqual({ xpath: '//*[@resource-id="post-detail-reply-text-field"]' });
  });

  it("clicks an EditText through its own resource id, or gives up without one", () => {
    const [focused] = matchNodes(FEED_45_9_3, { by: "edit_text" });
    expect(toV2Selector({ by: "edit_text" }, focused)).toEqual({ xpath: `//*[@resource-id="${TT}:id/zzz"]` });
    expect(toV2Selector({ by: "edit_text" }, { ...focused, resourceId: "" })).toBeNull();
  });

  it("quotes xpath strings safely", () => {
    expect(xpathString("plain")).toBe('"plain"');
    expect(xpathString('say "hi"')).toBe(`'say "hi"'`);
    expect(xpathString(`it's "both"`)).toBe(`concat("it's ",'"',"both",'"',"")`);
  });
});
