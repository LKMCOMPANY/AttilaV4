import { describe, expect, it } from "vitest";

import { parseCompactTree } from "./ui/compact-tree";
import {
  commentVerdict,
  countIncremented,
  followState,
  followVerified,
  likeState,
  likeVerified,
  parseCount,
  postedTextNode,
  textStillInField,
} from "./verifier";

const TT = "com.zhiliaoapp.musically";
function tree(lines: string[]) {
  return parseCompactTree(
    [
      "Screen 1080x2340 rotation=0",
      `[0] android.widget.FrameLayout package="${TT}" enabled=true bounds=[0,0][1080,2340]`,
      ...lines.map((l, i) => `  [${i}] ${l} package="${TT}" enabled=true bounds=[0,${i}][10,${i + 1}]`),
    ].join("\n"),
  );
}

describe("parseCount", () => {
  it("reads exact and abbreviated counts", () => {
    expect(parseCount("Like video. 941 likes")).toEqual({ value: 941, approximate: false });
    expect(parseCount("Read or add comments. 13,816 comments")).toEqual({ value: 13816, approximate: false });
    expect(parseCount("Like video 2.2M likes")).toEqual({ value: 2_200_000, approximate: true });
    expect(parseCount("Like video. 93.7K likes")).toEqual({ value: 93_700, approximate: true });
    expect(parseCount("Video liked")).toBeNull();
  });

  it("only confirms an increment on exact counts", () => {
    expect(countIncremented({ value: 941, approximate: false }, { value: 942, approximate: false })).toBe(true);
    expect(countIncremented({ value: 941, approximate: false }, { value: 943, approximate: false })).toBe(false);
    expect(countIncremented({ value: 2_200_000, approximate: true }, { value: 2_200_000, approximate: true })).toBe(false);
    expect(countIncremented(null, { value: 1, approximate: false })).toBe(false);
  });
});

describe("like", () => {
  const before = tree(['android.widget.Button content-desc="Like video. 941 likes" clickable=true', 'android.widget.Button text="941"']);
  const after = tree(['android.widget.Button content-desc="Video liked" clickable=true', 'android.widget.Button text="942"']);

  it("reads the state from the description", () => {
    expect(likeState(before)).toBe("not_liked");
    expect(likeState(after)).toBe("liked");
    expect(likeState(tree(['android.widget.TextView text="hello"']))).toBe("unknown");
  });

  it("verifies the flip, and does not accept a like that was already there", () => {
    expect(likeVerified(before, after)).toBe(true);
    expect(likeVerified(after, after)).toBe(false);
    expect(likeVerified(before, before)).toBe(false);
  });

  it("accepts the flip on abbreviated counts", () => {
    const b = tree(['android.widget.Button content-desc="Like video 2.2M likes"']);
    const a = tree(['android.widget.Button content-desc="Video liked"', 'android.widget.ImageView selected=true']);
    expect(likeVerified(b, a)).toBe(true);
  });
});

describe("follow", () => {
  const header = `${TT}:id/f9w`;
  const before = tree([`android.widget.TextView text="Follow" resource-id="${header}"`, 'android.widget.TextView text="9.6M Followers"']);
  // After the follow the header shows " Message" and suggestion cards carry their own Follow buttons.
  const after = tree([
    `android.widget.TextView text=" Message" resource-id="${header}"`,
    `android.widget.Button text="Follow" resource-id="${TT}:id/c9x"`,
    'android.widget.TextView text="Suggested accounts"',
  ]);

  it("judges the header node, not the suggestion cards", () => {
    expect(followState(before, header)).toBe("not_followed");
    expect(followState(after, header)).toBe("followed");
    expect(followVerified(before, after, header)).toBe(true);
  });

  it("without a header id, any Follow button means not followed", () => {
    expect(followState(after)).toBe("not_followed");
  });

  it("recognises the followed layout when the header node was replaced by an icon", () => {
    const iconised = tree(['android.widget.TextView text=" Message"', `android.widget.ImageView resource-id="${TT}:id/f9s"`]);
    expect(followState(iconised, header)).toBe("followed");
  });
});

describe("comment", () => {
  const text = "this is so well done, love it";

  it("is definitive when our text is a posted item", () => {
    const after = tree([`android.widget.TextView text="${text}" resource-id="${TT}:id/eim"`, 'android.widget.EditText text=""']);
    expect(postedTextNode(after, text)?.resourceId).toBe(`${TT}:id/eim`);
    expect(commentVerdict(after, text, { before: null, after: null })).toEqual({ verified: true, signal: "posted_item" });
  });

  it("is a hard negative when the text is still in the field", () => {
    const after = tree([`android.widget.EditText text="${text}"`]);
    expect(textStillInField(after, text)).toBe(true);
    expect(commentVerdict(after, text, { before: null, after: null }).signal).toBe("text_stuck");
  });

  it("accepts an exact count increment when the item scrolled out of view", () => {
    const after = tree(['android.widget.TextView text="25 comments"', 'android.widget.EditText text=""']);
    const verdict = commentVerdict(after, text, {
      before: { value: 24, approximate: false },
      after: { value: 25, approximate: false },
    });
    expect(verdict).toEqual({ verified: true, signal: "count_incremented" });
  });

  it("treats a cleared field with no signal as a silent drop, and an empty tree as unreadable", () => {
    const after = tree(['android.widget.EditText text=""']);
    expect(commentVerdict(after, text, { before: null, after: null }).signal).toBe("field_cleared_no_signal");
    expect(commentVerdict(parseCompactTree(""), text, { before: null, after: null }).signal).toBe("unreadable");
  });
});
