/**
 * The X timeline as a list of posts, read from the flat accessibility tree.
 *
 * On the Compose builds (12.2x) a post is rooted at a `timeline_post` node and
 * its action bar is a row of non-clickable Views described in the device's
 * language — Reply / Repost / Like / Impressions / Bookmark / Share — each
 * followed by its count as a TextView. Measured 11 September 2026 on box-1
 * (ES2 es-ES, GB2 en-GB, FR8 fr-FR, X 12.24.0-prod.02). The 11.x View builds
 * name their like `inline_like` and are not carried here: the only 11.x
 * device of the pilot (DE3) is behind X's version wall anyway.
 *
 * Pure functions of the parsed tree — no device I/O.
 */

import type { Bounds, CompactTree, TreeNode } from "./compact-tree";

/** The like button's description before a like, exact (case-insensitive). */
const X_LIKE_LABELS = ["like", "j'aime", "me gusta", "gefällt mir"];
/** The badge X prints on promoted posts. Measured en/es ("Ad") and de ("Werbung"). */
const X_AD_LABELS = ["ad", "werbung"];
const X_POST_ROOT_IDS = ["timeline_post", "com.twitter.android:id/outer_layout_row_view_tweet"];

export type XLikeState = "liked" | "not_liked" | "unknown";

export interface XPost {
  /** Index of the post's root node in the tree, -1 when the root is above the viewport. */
  rootIndex: number;
  likeNode: TreeNode;
  /** The exact like count printed next to the heart, when X does not abbreviate it. */
  likeCount: number | null;
  /** A promoted post ("Ad"): a person scrolls past those. */
  promoted: boolean;
}

function normalise(desc: string): string {
  return desc.trim().toLowerCase();
}

/**
 * What the like button says about the post: its label alone means not liked;
 * the same label wrapped in more words means liked — "Undo Like" (en-GB),
 * "Annuler le J'aime" (fr-FR), "Deshacer Me gusta" (es-ES), all measured on
 * 12.24 the same day.
 */
export function xLikeState(node: TreeNode | null | undefined): XLikeState {
  if (!node) return "unknown";
  const desc = normalise(node.contentDesc);
  if (!desc) return "unknown";
  if (X_LIKE_LABELS.includes(desc)) return "not_liked";
  if (X_LIKE_LABELS.some((label) => desc.includes(label)) || desc === "liked") return "liked";
  return "unknown";
}

function exactCount(node: TreeNode | undefined): number | null {
  if (!node || !node.className.endsWith("TextView")) return null;
  const text = node.text.trim();
  if (!/^\d{1,3}(?:[.,]\d{3})*$/.test(text)) return null;
  return Number(text.replace(/[.,]/g, ""));
}

/** The posts whose like button is in the tree, in screen order. */
export function xPostsOnScreen(tree: CompactTree): XPost[] {
  const { nodes } = tree;
  const roots = nodes.map((n, i) => (X_POST_ROOT_IDS.includes(n.resourceId) ? i : -1)).filter((i) => i >= 0);
  const posts: XPost[] = [];
  nodes.forEach((node, index) => {
    if (!node.bounds || xLikeState(node) === "unknown") return;
    const rootIndex = [...roots].reverse().find((r) => r <= index) ?? -1;
    const nextRoot = roots.find((r) => r > index) ?? nodes.length;
    const block = nodes.slice(Math.max(0, rootIndex), nextRoot);
    posts.push({
      rootIndex,
      likeNode: node,
      likeCount: exactCount(nodes[index + 1]),
      promoted: block.some((b) => X_AD_LABELS.includes(normalise(b.text))),
    });
  });
  return posts;
}

function fullyVisible(bounds: Bounds, height: number): boolean {
  return bounds.top >= 0 && bounds.bottom <= height && bounds.bottom > bounds.top;
}

/**
 * The post a person would like from this screen: not promoted, not liked yet,
 * its heart fully on screen, the closest to the middle. Null when none.
 */
export function likeablePost(tree: CompactTree): XPost | null {
  const height = tree.height || 2340;
  const candidates = xPostsOnScreen(tree).filter(
    (p) => !p.promoted && xLikeState(p.likeNode) === "not_liked" && p.likeNode.bounds && fullyVisible(p.likeNode.bounds, height),
  );
  if (candidates.length === 0) return null;
  const centreOf = (p: XPost) => (p.likeNode.bounds!.top + p.likeNode.bounds!.bottom) / 2;
  return candidates.reduce((best, p) => (Math.abs(centreOf(p) - height / 2) < Math.abs(centreOf(best) - height / 2) ? p : best));
}

/**
 * The like on `post` is verified when the button at the same place in the
 * fresh tree now reads liked; an exact count moving by one corroborates and
 * a count moving any other way contradicts.
 */
export function xLikeVerified(post: XPost, after: CompactTree): boolean {
  const before = post.likeNode.bounds;
  if (!before) return false;
  const sameSpot = after.nodes.findIndex(
    (n) => n.bounds && n.bounds.left === before.left && n.bounds.top === before.top && n.bounds.right === before.right && n.bounds.bottom === before.bottom && xLikeState(n) !== "unknown",
  );
  if (sameSpot < 0 || xLikeState(after.nodes[sameSpot]) !== "liked") return false;
  const countAfter = exactCount(after.nodes[sameSpot + 1]);
  if (post.likeCount !== null && countAfter !== null) return countAfter === post.likeCount + 1;
  return true;
}
