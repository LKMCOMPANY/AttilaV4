import { describe, expect, it } from "vitest";

import { parseCompactTree } from "./compact-tree";
import { likeablePost, xLikeState, xLikeVerified, xPostsOnScreen } from "./x-feed";

const X = "com.twitter.android";

/** A compact dump from `[attrs, bounds]` lines, all at depth 1 (X 12.24 shape). */
function tree(lines: Array<[string, string]>, height = 2340) {
  return parseCompactTree(
    [
      `Screen 1080x${height} rotation=0`,
      `[0] android.widget.FrameLayout resource-id="android:id/content" package="${X}" enabled=true bounds=[0,0][1080,${height}]`,
      ...lines.map(([attrs, bounds], i) => `  [${i + 1}] ${attrs} package="${X}" enabled=true bounds=${bounds}`),
    ].join("\n"),
  );
}

/** One post's action bar as measured on 12.24: Reply, Repost, Like (+ count), Impressions. */
function actionBar(likeDesc: string, likeCount: string, top: number, extra: Array<[string, string]> = []): Array<[string, string]> {
  const row = (x1: number, x2: number) => `[${x1},${top}][${x2},${top + 48}]`;
  return [
    ['android.view.View resource-id="timeline_post"', `[0,${top - 400}][1080,${top + 120}]`],
    ['android.view.View content-desc="Reply"', row(180, 228)],
    ['android.widget.TextView text="2"', row(240, 261)],
    ['android.view.View content-desc="Repost"', row(369, 417)],
    ['android.widget.TextView text="30"', row(429, 475)],
    [`android.view.View content-desc="${likeDesc}"`, row(558, 606)],
    [`android.widget.TextView text="${likeCount}"`, row(618, 658)],
    ['android.view.View content-desc="Impressions"', row(747, 795)],
    ['android.widget.TextView text="39,9K"', row(807, 864)],
    ...extra,
  ];
}

describe("X timeline — like buttons", () => {
  it("reads the like state from the button's description in every measured language", () => {
    const state = (desc: string) => xLikeState(tree([[`android.view.View content-desc="${desc}"`, "[558,415][606,463]"]]).nodes[1]);
    expect(state("Like")).toBe("not_liked");
    expect(state("Me gusta")).toBe("not_liked");
    expect(state("J'aime")).toBe("not_liked");
    // The three liked forms measured on 11 September 2026 (ES2, FR8, GB2).
    expect(state("Deshacer Me gusta")).toBe("liked");
    expect(state("Annuler le J'aime")).toBe("liked");
    expect(state("Undo Like")).toBe("liked");
    expect(state("Repost")).toBe("unknown");
  });

  // ES2: a promoted post ("Ad") lower on screen next to a normal one.
  it("lists the posts on screen, flags the promoted one and reads exact counts only", () => {
    const t = tree([
      ...actionBar("Me gusta", "1K", 415),
      ...actionBar("Me gusta", "935", 1975, [['android.widget.TextView text="Ad"', "[927,2092][948,2146]"]]),
    ]);
    const posts = xPostsOnScreen(t);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({ likeCount: null, promoted: false });
    expect(posts[1]).toMatchObject({ likeCount: 935, promoted: true });
  });

  it("picks the non-promoted, not yet liked post whose heart is fully on screen and closest to the middle", () => {
    const t = tree([
      ...actionBar("Like", "554", 300),
      ...actionBar("Like", "12", 1100, [['android.widget.TextView text="Ad"', "[927,1200][948,1250]"]]),
      ...actionBar("Liked", "7", 1500),
      ...actionBar("Like", "88", 1900),
    ]);
    const pick = likeablePost(t);
    expect(pick?.likeCount).toBe(88);
  });

  it("returns null when every heart is promoted, liked or cut off", () => {
    const t = tree([
      ...actionBar("Like", "12", 1100, [['android.widget.TextView text="Ad"', "[927,1200][948,1250]"]]),
      ...actionBar("Liked", "7", 1500),
      ...actionBar("Like", "88", 2320),
    ]);
    expect(likeablePost(t)).toBeNull();
  });

  it("verifies a like from the fresh tree: same spot, liked label, count +1 when exact", () => {
    const before = tree(actionBar("Me gusta", "52", 1282));
    const post = likeablePost(before)!;
    expect(xLikeVerified(post, tree(actionBar("Deshacer Me gusta", "53", 1282)))).toBe(true);
    // Abbreviated count: the label alone decides.
    const big = likeablePost(tree(actionBar("Me gusta", "1K", 415)))!;
    expect(xLikeVerified(big, tree(actionBar("Deshacer Me gusta", "1K", 415)))).toBe(true);
    // Label unchanged (GB2/FR8 first read after the tap): not verified.
    expect(xLikeVerified(post, tree(actionBar("Me gusta", "52", 1282)))).toBe(false);
    // Liked label but the exact count did not move by one: not verified.
    expect(xLikeVerified(post, tree(actionBar("Deshacer Me gusta", "52", 1282)))).toBe(false);
    // The post moved: nothing at the same spot, not verified.
    expect(xLikeVerified(post, tree(actionBar("Deshacer Me gusta", "53", 900)))).toBe(false);
  });
});
