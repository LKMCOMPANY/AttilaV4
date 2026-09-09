/**
 * Named UI targets ("the like button", "the comment field") resolved to
 * concrete node matchers per app build and locale.
 *
 * Doctrine, measured on the fleet on 9 September 2026:
 *   - `content-desc` substrings are stable across TikTok builds (44.8 → 45.9)
 *     and are the primary matcher;
 *   - resource ids change with every build (`fn3` → `fsv`, `h45` → `hc0`) and
 *     are the versioned fallback, seeded here and extended through the
 *     `app_ui_selectors` table;
 *   - exact `@text` is used for buttons only (Follow, Reply) and is locale-bound;
 *   - class-name xpaths and boolean predicates miss on the agent, so an
 *     `EditText` is located from the parsed tree and clicked by its resource id.
 *
 * A matcher is applied to the parsed tree first (no device round-trip); the
 * matching node then yields the v2 selector to act on. Pure functions.
 */

import type { V2Selector } from "@/lib/box-api";
import {
  editTexts,
  findByDescContains,
  findByResourceId,
  findByText,
  type CompactTree,
  type TreeNode,
} from "./compact-tree";

export type NodeMatcher =
  | { by: "desc_contains"; value: string }
  | { by: "text"; value: string }
  | { by: "resource_id"; value: string }
  /** The focused EditText, else the largest one — the comment/search field. */
  | { by: "edit_text" };

export interface SelectorCandidate {
  matcher: NodeMatcher;
  /** Inclusive `versionCode` bounds; absent = any build. */
  versionMin?: number;
  versionMax?: number;
  /** BCP-47 language (`en`, `fr`, `es`); absent = any locale. */
  language?: string;
  /** Lower tries first. Seeds: 10 = desc/id verified, 50 = text, 90 = last resort. */
  priority: number;
  note?: string;
}

export type SelectorKey =
  | "tiktok.like_button"
  | "tiktok.comments_button"
  | "tiktok.comment_field"
  | "tiktok.send_button"
  | "tiktok.follow_button"
  | "tiktok.search_entry"
  | "tiktok.search_field"
  | "tiktok.home_tab"
  | "x.reply_field"
  | "x.reply_button"
  | "x.like_button"
  | "x.home_tab";

const TT = "com.zhiliaoapp.musically:id/";

// versionCode = 20 2 MM mm pp 0 for TikTok (44.8.3 → 2024408030).
const TT_44_8_3 = 2024408030;
const TT_45_0_3 = 2024500030;
const TT_45_9_3 = 2024509030;

export const SELECTOR_SEEDS: Record<SelectorKey, SelectorCandidate[]> = {
  "tiktok.like_button": [
    { matcher: { by: "desc_contains", value: "Like video" }, priority: 10, language: "en", note: "44.8–45.9" },
    { matcher: { by: "desc_contains", value: "J'aime la vidéo" }, priority: 10, language: "fr" },
    { matcher: { by: "desc_contains", value: "Me gusta el video" }, priority: 10, language: "es" },
    { matcher: { by: "resource_id", value: `${TT}fn3` }, versionMin: TT_45_0_3, versionMax: TT_45_0_3, priority: 20 },
    { matcher: { by: "resource_id", value: `${TT}fsv` }, versionMin: TT_45_9_3, versionMax: TT_45_9_3, priority: 20 },
  ],
  "tiktok.comments_button": [
    { matcher: { by: "desc_contains", value: "comments" }, priority: 10, language: "en", note: "Read or add comments. N comments" },
    { matcher: { by: "desc_contains", value: "commentaires" }, priority: 10, language: "fr" },
    { matcher: { by: "desc_contains", value: "comentarios" }, priority: 10, language: "es" },
  ],
  "tiktok.comment_field": [
    { matcher: { by: "resource_id", value: `${TT}e02` }, versionMin: TT_44_8_3, versionMax: TT_44_8_3, priority: 10 },
    { matcher: { by: "edit_text" }, priority: 50 },
  ],
  "tiktok.send_button": [
    { matcher: { by: "resource_id", value: `${TT}cj9` }, versionMin: TT_44_8_3, versionMax: TT_44_8_3, priority: 10, note: "content-desc is an unresolved @213… string" },
  ],
  "tiktok.follow_button": [
    { matcher: { by: "text", value: "Follow" }, priority: 50, language: "en", note: "profile header; non-clickable TextView, click still lands" },
    { matcher: { by: "text", value: "Suivre" }, priority: 50, language: "fr" },
    { matcher: { by: "text", value: "Seguir" }, priority: 50, language: "es" },
    { matcher: { by: "resource_id", value: `${TT}f4c` }, versionMin: TT_45_0_3, versionMax: TT_45_0_3, priority: 20 },
    { matcher: { by: "resource_id", value: `${TT}f9w` }, versionMin: TT_45_9_3, versionMax: TT_45_9_3, priority: 20 },
  ],
  "tiktok.search_entry": [
    { matcher: { by: "desc_contains", value: "Search" }, priority: 10, language: "en" },
    { matcher: { by: "desc_contains", value: "Rechercher" }, priority: 10, language: "fr" },
    { matcher: { by: "desc_contains", value: "Buscar" }, priority: 10, language: "es" },
    { matcher: { by: "resource_id", value: `${TT}jfu` }, versionMin: TT_45_0_3, versionMax: TT_45_0_3, priority: 20 },
    { matcher: { by: "resource_id", value: `${TT}jpk` }, versionMin: TT_45_9_3, versionMax: TT_45_9_3, priority: 20 },
  ],
  "tiktok.search_field": [
    { matcher: { by: "resource_id", value: `${TT}h45` }, versionMin: TT_45_0_3, versionMax: TT_45_0_3, priority: 10 },
    { matcher: { by: "resource_id", value: `${TT}hc0` }, versionMin: TT_45_9_3, versionMax: TT_45_9_3, priority: 10 },
    { matcher: { by: "edit_text" }, priority: 50 },
  ],
  "tiktok.home_tab": [
    { matcher: { by: "desc_contains", value: "Home" }, priority: 10, language: "en" },
    { matcher: { by: "desc_contains", value: "Accueil" }, priority: 10, language: "fr" },
    { matcher: { by: "desc_contains", value: "Inicio" }, priority: 10, language: "es" },
  ],
  "x.reply_field": [
    { matcher: { by: "resource_id", value: "post-detail-reply-text-field" }, priority: 10, note: "no package prefix on X ids" },
    { matcher: { by: "edit_text" }, priority: 50 },
  ],
  "x.reply_button": [
    { matcher: { by: "text", value: "Reply" }, priority: 50, language: "en", note: "the reply icon carries the same word as content-desc" },
    { matcher: { by: "text", value: "Répondre" }, priority: 50, language: "fr" },
    { matcher: { by: "text", value: "Responder" }, priority: 50, language: "es" },
  ],
  "x.like_button": [
    { matcher: { by: "desc_contains", value: "Like" }, priority: 90, language: "en", note: "unverified — phase 0 test on box-3" },
  ],
  "x.home_tab": [
    { matcher: { by: "desc_contains", value: "Home" }, priority: 10, language: "en" },
    { matcher: { by: "desc_contains", value: "Accueil" }, priority: 10, language: "fr" },
  ],
};

export interface SelectorContext {
  /** App `versionCode` on the device, when known. */
  versionCode?: number | null;
  /** Device locale (`en-GB`, `fr-FR`); only the language part is used. */
  locale?: string | null;
}

function languageOf(locale: string | null | undefined): string | null {
  if (!locale) return null;
  return locale.split(/[-_]/)[0]?.toLowerCase() ?? null;
}

function applies(c: SelectorCandidate, ctx: SelectorContext): boolean {
  const v = ctx.versionCode ?? null;
  if (c.versionMin != null && (v == null || v < c.versionMin)) return false;
  if (c.versionMax != null && (v == null || v > c.versionMax)) return false;
  if (c.language) {
    const lang = languageOf(ctx.locale);
    // Unknown device locale: keep every language candidate, English first.
    if (lang && lang !== c.language) return false;
  }
  return true;
}

/**
 * Candidates for a key, filtered by build and locale, ordered by priority.
 * `extra` are rows of `app_ui_selectors` for the same key (operators can add a
 * matcher for a new build without a deploy); they compete on priority.
 */
export function resolveCandidates(
  key: SelectorKey,
  ctx: SelectorContext,
  extra: readonly SelectorCandidate[] = [],
): SelectorCandidate[] {
  return [...SELECTOR_SEEDS[key], ...extra]
    .filter((c) => applies(c, ctx))
    .sort((a, b) => a.priority - b.priority);
}

/** Nodes of the parsed tree a matcher designates. */
export function matchNodes(tree: CompactTree, matcher: NodeMatcher): TreeNode[] {
  switch (matcher.by) {
    case "desc_contains":
      return findByDescContains(tree.nodes, matcher.value);
    case "text":
      return findByText(tree.nodes, matcher.value);
    case "resource_id":
      return findByResourceId(tree.nodes, matcher.value);
    case "edit_text": {
      const fields = editTexts(tree.nodes);
      const focused = fields.find((n) => n.focused);
      if (focused) return [focused];
      return fields.length > 0 ? [largest(fields)] : [];
    }
  }
}

function largest(nodes: TreeNode[]): TreeNode {
  return nodes.reduce((best, n) => (area(n) > area(best) ? n : best));
}

function area(n: TreeNode): number {
  if (!n.bounds) return 0;
  return Math.max(0, n.bounds.right - n.bounds.left) * Math.max(0, n.bounds.bottom - n.bounds.top);
}

/**
 * The v2 selector to act on for a matcher, given the node it matched. Strict
 * equalities are only emitted for `@text` and `@resource-id`; description
 * matching always goes through `contains()` because the agent's `content_desc`
 * selector is an exact, case- and apostrophe-sensitive comparison.
 */
export function toV2Selector(matcher: NodeMatcher, node: TreeNode): V2Selector | null {
  switch (matcher.by) {
    case "desc_contains":
      return { xpath: `//*[contains(@content-desc,${xpathString(matcher.value)})]` };
    case "text":
      return { xpath: `//*[@text=${xpathString(matcher.value)}]` };
    case "resource_id":
      return { xpath: `//*[@resource-id=${xpathString(matcher.value)}]` };
    case "edit_text":
      return node.resourceId ? { xpath: `//*[@resource-id=${xpathString(node.resourceId)}]` } : null;
  }
}

/** XPath 1.0 has no escape: pick the quote the value does not contain. */
export function xpathString(value: string): string {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  return `concat("${value.split('"').join(`",'"',"`)}")`;
}

export interface ResolvedTarget {
  candidate: SelectorCandidate;
  node: TreeNode;
  selector: V2Selector | null;
}

/**
 * Find the first candidate present in the current tree. Returns null when no
 * candidate matches — the caller then knows the target is not on screen
 * without paying a `wait_timeout` on the device.
 */
export function resolveInTree(
  key: SelectorKey,
  tree: CompactTree,
  ctx: SelectorContext,
  extra: readonly SelectorCandidate[] = [],
): ResolvedTarget | null {
  for (const candidate of resolveCandidates(key, ctx, extra)) {
    const nodes = matchNodes(tree, candidate.matcher);
    if (nodes.length === 0) continue;
    const node = nodes[0];
    return { candidate, node, selector: toV2Selector(candidate.matcher, node) };
  }
  return null;
}
