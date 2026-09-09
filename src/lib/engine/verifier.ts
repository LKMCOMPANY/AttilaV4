/**
 * Positive-signal verification: what the tree must show for an action to
 * count as done. "Cannot verify" is never a pass (AGENTS.md hard rule 6).
 *
 * Every function is a pure judgement over one or two parsed trees; the device
 * I/O (reading a fresh tree, opening a panel again) is the reader's job.
 * Signals were measured on 9 September 2026 and are documented per function.
 */

import {
  editTexts,
  findByDescContains,
  findByText,
  textMatches,
  type CompactTree,
  type TreeNode,
} from "./ui/compact-tree";

// ---------------------------------------------------------------------------
// Counts — "13,816 comments", "2.2M likes", "941"
// ---------------------------------------------------------------------------

export interface ParsedCount {
  value: number;
  /** True when the platform abbreviated (K/M): not usable for a +1 check. */
  approximate: boolean;
}

// Number, optional abbreviation: EN "93.7K" / "2.2M", ES/PT "786,8 mil" / "1,2 M",
// FR "786,8 k" / "1,2 M". A decimal comma before an abbreviation is a decimal.
const COUNT_RE = /(\d[\d.,\s]*)\s*(mil\b|[kKmM]\b)?/;

/** Parse the leading number of a label. Null when there is none. */
export function parseCount(label: string): ParsedCount | null {
  const m = COUNT_RE.exec(label.replace(/\u00a0/g, " "));
  if (!m) return null;
  const suffix = m[2]?.toLowerCase();
  const raw = m[1].replace(/\s/g, "");
  // With an abbreviation, "," and "." are both decimal marks ("786,8 mil").
  // Without one, "," groups thousands ("13,816") and "." makes it not a count.
  const digits = suffix ? raw.replace(",", ".") : raw.replace(/,/g, "");
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  if (suffix === "k" || suffix === "mil") return { value: Math.round(n * 1_000), approximate: true };
  if (suffix === "m") return { value: Math.round(n * 1_000_000), approximate: true };
  if (digits.includes(".")) return null;
  return { value: n, approximate: false };
}

/** Exact counts only: `after === before + 1`. Approximate counts never confirm. */
export function countIncremented(before: ParsedCount | null, after: ParsedCount | null): boolean {
  if (!before || !after || before.approximate || after.approximate) return false;
  return after.value === before.value + 1;
}

// ---------------------------------------------------------------------------
// Posted text — a comment or reply read back as a rendered item
// ---------------------------------------------------------------------------

/**
 * Our text present in a node that is NOT an input field. The just-posted
 * comment renders as a TextView at the top of the list (TikTok) or in the
 * thread (X); text still inside an EditText means it was never sent.
 */
export function postedTextNode(tree: CompactTree, text: string): TreeNode | null {
  return (
    tree.nodes.find(
      (n) => n.className !== "android.widget.EditText" && textMatches(n.text, text),
    ) ?? null
  );
}

/** The typed text still sits in an input field — the send did not happen. */
export function textStillInField(tree: CompactTree, text: string): boolean {
  return editTexts(tree.nodes).some((n) => textMatches(n.text, text));
}

/** Every input field on screen is empty (or only shows its hint). */
export function fieldsEmpty(tree: CompactTree, hints: readonly string[] = []): boolean {
  return editTexts(tree.nodes).every(
    (n) => n.text.trim() === "" || hints.some((h) => n.text.trim().toLowerCase() === h.toLowerCase()),
  );
}

// ---------------------------------------------------------------------------
// TikTok like — "Like video. 941 likes" → "Video liked" (+ count, +selected)
// ---------------------------------------------------------------------------

export type LikeState = "liked" | "not_liked" | "unknown";

// EN measured on 45.0.3 / 45.9.3; ES "Dar me gusta al vídeo" measured on 44.9.3;
// the ES/FR liked forms are best guesses to be confirmed on a device.
const LIKED_DESC = ["video liked", "vidéo aimée", "quitar me gusta", "unlike"];
const NOT_LIKED_DESC = ["like video", "j'aime la vidéo", "dar me gusta"];

export function likeState(tree: CompactTree): LikeState {
  for (const marker of LIKED_DESC) if (findByDescContains(tree.nodes, marker).length > 0) return "liked";
  for (const marker of NOT_LIKED_DESC) if (findByDescContains(tree.nodes, marker).length > 0) return "not_liked";
  return "unknown";
}

/** The like count carried by the heart's description, when the platform puts one there. */
export function likeCount(tree: CompactTree): ParsedCount | null {
  for (const marker of [...NOT_LIKED_DESC, ...LIKED_DESC]) {
    const node = findByDescContains(tree.nodes, marker)[0];
    if (node) return parseCount(node.contentDesc);
  }
  return null;
}

/**
 * A like is verified when the state flipped to liked; the exact count moving
 * by one corroborates but is not required (counts above 10K are abbreviated).
 */
export function likeVerified(before: CompactTree, after: CompactTree): boolean {
  if (likeState(before) !== "not_liked") return false;
  if (likeState(after) !== "liked") return false;
  const b = likeCount(before);
  const a = likeCount(after);
  if (b && a && !b.approximate && !a.approximate) return a.value === b.value + 1;
  return true;
}

// ---------------------------------------------------------------------------
// TikTok follow — "Follow" disappears from the header, "Message" appears
// ---------------------------------------------------------------------------

export type FollowState = "followed" | "not_followed" | "unknown";

const FOLLOW_LABELS = ["Follow", "Suivre", "Seguir"];
const FOLLOWED_LABELS = ["Message", "Following", "Friends", "Abonné(e)", "Abonné", "Siguiendo", "Mensaje"];

/**
 * Judge the profile HEADER only — the "Suggested accounts" row that appears
 * after a follow carries its own Follow buttons, so the header node is the
 * one whose text we compare (pass its resource id when known).
 */
export function followState(tree: CompactTree, headerResourceId?: string | null): FollowState {
  const header = headerResourceId
    ? tree.nodes.filter((n) => n.resourceId === headerResourceId)
    : tree.nodes;
  const labels = header.map((n) => n.text.trim());
  if (labels.some((t) => FOLLOW_LABELS.includes(t))) return "not_followed";
  if (labels.some((t) => FOLLOWED_LABELS.includes(t))) return "followed";
  if (!headerResourceId) return "unknown";
  // The header node vanished (replaced by an icon button): with a "Message"
  // label anywhere on screen, that is the followed layout.
  return findByText(tree.nodes, "Message").length > 0 || findByText(tree.nodes, " Message").length > 0
    ? "followed"
    : "unknown";
}

export function followVerified(before: CompactTree, after: CompactTree, headerResourceId?: string | null): boolean {
  return followState(before, headerResourceId) === "not_followed" && followState(after, headerResourceId) === "followed";
}

// ---------------------------------------------------------------------------
// Comment / reply — posted item read back, field empty, count +1 when exact
// ---------------------------------------------------------------------------

export interface CommentVerdict {
  verified: boolean;
  /** Which signal decided, for the step journal. */
  signal: "posted_item" | "count_incremented" | "text_stuck" | "field_cleared_no_signal" | "unreadable";
}

/**
 * The comment flow's contract: our text read back as a posted item is
 * definitive; the exact count moving by one corroborates; text still in the
 * field is a hard negative; a cleared field with neither signal is a silent
 * drop, not a success.
 */
export function commentVerdict(
  after: CompactTree,
  text: string,
  counts: { before: ParsedCount | null; after: ParsedCount | null },
): CommentVerdict {
  if (after.nodes.length === 0) return { verified: false, signal: "unreadable" };
  if (postedTextNode(after, text)) return { verified: true, signal: "posted_item" };
  if (textStillInField(after, text)) return { verified: false, signal: "text_stuck" };
  if (countIncremented(counts.before, counts.after)) return { verified: true, signal: "count_incremented" };
  return { verified: false, signal: "field_cleared_no_signal" };
}
