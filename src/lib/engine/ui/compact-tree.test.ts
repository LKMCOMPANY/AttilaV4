import { describe, expect, it } from "vitest";

import {
  editTexts,
  findByDescContains,
  findByResourceId,
  findByText,
  nodeCenter,
  packagesOf,
  parseCompactTree,
  textMatches,
  visibleText,
} from "./compact-tree";

// Lines lifted from a real `dump_compact` of TikTok 45.0.3 (box-2, 9 September 2026).
const FEED = [
  "Screen 1080x2340 rotation=0",
  '[0] android.widget.FrameLayout resource-id="android:id/content" package="com.zhiliaoapp.musically" enabled=true bounds=[0,0][1080,2340]',
  '  [1] android.widget.FrameLayout resource-id="com.zhiliaoapp.musically:id/eew" package="com.zhiliaoapp.musically" clickable=true enabled=true focusable=true bounds=[888,1287][1080,1467]',
  '    [0] android.widget.Button resource-id="com.zhiliaoapp.musically:id/fn3" package="com.zhiliaoapp.musically" content-desc="Like video. 941 likes" clickable=true enabled=true focusable=true bounds=[888,1287][1080,1467]',
  '      [0] android.widget.Button text="941" resource-id="com.zhiliaoapp.musically:id/fms" package="com.zhiliaoapp.musically" clickable=true enabled=true bounds=[888,1421][1080,1447]',
  '    [1] android.widget.FrameLayout resource-id="com.zhiliaoapp.musically:id/lsa" package="com.zhiliaoapp.musically" clickable=true enabled=true focusable=true NAF=true bounds=[516,0][564,90]',
  '  [2] android.widget.EditText text="\u200enba highlights" resource-id="com.zhiliaoapp.musically:id/h45" package="com.zhiliaoapp.musically" clickable=true enabled=true focusable=true focused=true bounds=[120,90][960,200]',
].join("\n");

describe("parseCompactTree", () => {
  it("reads the screen header and every node with its depth", () => {
    const tree = parseCompactTree(FEED);
    expect(tree.width).toBe(1080);
    expect(tree.height).toBe(2340);
    expect(tree.rotation).toBe(0);
    expect(tree.nodes).toHaveLength(6);
    expect(tree.nodes.map((n) => n.depth)).toEqual([0, 1, 2, 3, 2, 1]);
    expect(tree.nodes[0].resourceId).toBe("android:id/content");
  });

  it("reads quoted attributes, flags and bounds", () => {
    const like = findByResourceId(parseCompactTree(FEED).nodes, "com.zhiliaoapp.musically:id/fn3")[0];
    expect(like.className).toBe("android.widget.Button");
    expect(like.contentDesc).toBe("Like video. 941 likes");
    expect(like.clickable).toBe(true);
    expect(like.focused).toBe(false);
    expect(like.bounds).toEqual({ left: 888, top: 1287, right: 1080, bottom: 1467 });
    expect(nodeCenter(like)).toEqual({ x: 984, y: 1377 });
  });

  it("marks NAF nodes and keeps the count TextView text", () => {
    const nodes = parseCompactTree(FEED).nodes;
    expect(findByResourceId(nodes, "com.zhiliaoapp.musically:id/lsa")[0].naf).toBe(true);
    expect(findByText(nodes, "941")).toHaveLength(1);
  });

  // TikTok prefixes some strings with a LEFT-TO-RIGHT MARK; matchers must not see it.
  it("strips invisible bidi marks from text", () => {
    const field = editTexts(parseCompactTree(FEED).nodes)[0];
    expect(field.text).toBe("nba highlights");
    expect(field.focused).toBe(true);
  });

  // Captions carry unescaped quotes; the lazy value + lookahead keeps them whole.
  it("tolerates an unescaped quote inside a caption", () => {
    const line =
      '[0] X.16Mv text="he said "hello" and left #fyp" resource-id="com.zhiliaoapp.musically:id/desc" package="com.zhiliaoapp.musically" enabled=true bounds=[0,0][10,10]';
    const [node] = parseCompactTree(`Screen 1080x2340 rotation=0\n${line}`).nodes;
    expect(node.text).toBe('he said "hello" and left #fyp');
    expect(node.resourceId).toBe("com.zhiliaoapp.musically:id/desc");
  });

  it("yields zero nodes on an empty payload", () => {
    expect(parseCompactTree("").nodes).toHaveLength(0);
    expect(parseCompactTree("Screen 1080x2340 rotation=0").nodes).toHaveLength(0);
  });

  it("hashes the raw text so identical dumps are detectable", () => {
    expect(parseCompactTree(FEED).hash).toBe(parseCompactTree(FEED).hash);
    expect(parseCompactTree(FEED).hash).not.toBe(parseCompactTree(FEED + "\n").hash);
  });
});

describe("tree queries", () => {
  const nodes = parseCompactTree(FEED).nodes;

  it("matches content-desc case-insensitively as a substring", () => {
    expect(findByDescContains(nodes, "like video")).toHaveLength(1);
    expect(findByDescContains(nodes, "LIKE")).toHaveLength(1);
  });

  it("lists packages top-window first", () => {
    expect(packagesOf(nodes)).toEqual(["com.zhiliaoapp.musically"]);
  });

  it("builds a lower-cased haystack of everything visible", () => {
    const hay = visibleText(nodes);
    expect(hay).toContain("like video. 941 likes");
    expect(hay).toContain("nba highlights");
  });

  it("compares typed text by a whitespace-collapsed prefix", () => {
    expect(textMatches(" this is so  well done", "this is so well done 👏")).toBe(true);
    expect(textMatches("something else", "this is so well done")).toBe(false);
    expect(textMatches("", "x")).toBe(false);
  });
});
