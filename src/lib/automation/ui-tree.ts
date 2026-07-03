/**
 * Pure parsing helpers for `uiautomator dump` output.
 *
 * The Android UI tree is an XML document of `<node .../>` elements. These
 * helpers turn it into a queryable structure so the automation flows can make
 * decisions on *what is actually on screen* (composer open? text landed? still
 * stuck in the field?) instead of tapping fixed coordinates blindly.
 *
 * Everything here is a pure function of the XML string — no device I/O — so it
 * is trivially testable and shared by every platform module. Device-side dump
 * retrieval lives in `adb-helpers.ts` (`dumpUi`).
 */

export interface UiNode {
  text: string;
  resourceId: string;
  className: string;
  contentDesc: string;
  packageName: string;
  focused: boolean;
  clickable: boolean;
  /** [x1, y1, x2, y2] in device pixels, or null when the node has no bounds. */
  bounds: [number, number, number, number] | null;
}

export interface Point {
  x: number;
  y: number;
}

const NODE_RE = /<node\b([^>]*?)\/?>/g;
const ATTR_RE = /([\w-]+)="([^"]*)"/g;
const BOUNDS_RE = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/;

// Bidi and zero-width control characters. TikTok prefixes some strings with a
// LEFT-TO-RIGHT MARK (U+200E) — e.g. the comments title "\u200e1109 comentarios"
// — which silently broke prefix/regex matching until stripped. We remove the
// whole invisible-formatting family so every matcher sees clean text.
const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Decode the XML entities uiautomator emits in text attributes and strip
 * invisible bidi/zero-width control characters so downstream matching is
 * robust.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(INVISIBLE_RE, "");
}

/** Parse every `<node>` element into a typed structure. */
export function parseUiNodes(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  for (const nodeMatch of xml.matchAll(NODE_RE)) {
    const raw = nodeMatch[1];
    const attrs: Record<string, string> = {};
    for (const attrMatch of raw.matchAll(ATTR_RE)) {
      attrs[attrMatch[1]] = attrMatch[2];
    }

    const boundsMatch = attrs.bounds ? BOUNDS_RE.exec(attrs.bounds) : null;

    nodes.push({
      text: decodeEntities(attrs.text ?? ""),
      resourceId: attrs["resource-id"] ?? "",
      className: attrs.class ?? "",
      contentDesc: decodeEntities(attrs["content-desc"] ?? ""),
      packageName: attrs.package ?? "",
      focused: attrs.focused === "true",
      clickable: attrs.clickable === "true",
      bounds: boundsMatch
        ? [
            Number(boundsMatch[1]),
            Number(boundsMatch[2]),
            Number(boundsMatch[3]),
            Number(boundsMatch[4]),
          ]
        : null,
    });
  }
  return nodes;
}

/** Geometric centre of a node's bounds, or null when it has none/zero area. */
function nodeCenter(node: UiNode): Point | null {
  if (!node.bounds) return null;
  const [x1, y1, x2, y2] = node.bounds;
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
}

const EDIT_TEXT_CLASS = "android.widget.EditText";

function boundsArea(node: UiNode): number {
  if (!node.bounds) return 0;
  const [x1, y1, x2, y2] = node.bounds;
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

/**
 * Best candidate for "the comment input field": prefer the focused EditText,
 * otherwise the largest EditText (the expanded composer is bigger than the
 * collapsed placeholder bar). Resource-ids are obfuscated and build/locale
 * specific, so we never key off them.
 */
export function findCommentEditText(nodes: UiNode[]): UiNode | null {
  const editTexts = nodes.filter((n) => n.className === EDIT_TEXT_CLASS);
  if (editTexts.length === 0) return null;
  const focused = editTexts.find((n) => n.focused);
  if (focused) return focused;
  return editTexts.reduce((biggest, n) =>
    boundsArea(n) > boundsArea(biggest) ? n : biggest,
  );
}

/** Whether any EditText in the tree still holds (a normalized form of) `text`. */
export function editTextContains(nodes: UiNode[], text: string): boolean {
  return nodes.some(
    (n) => n.className === EDIT_TEXT_CLASS && normalizedIncludes(n.text, text),
  );
}

/**
 * The comments bottom-sheet title, across locales. TikTok prefixes it with the
 * count ("95 comentarios", "1 comment") and sometimes shows it bare
 * ("Comentarios" on a be-the-first video), so we match an optional leading
 * count followed by the localized word — never a bare substring, which a
 * comment body containing the word "comments" could trip. Presence means the
 * panel is open even before the input EditText has materialised on focus.
 */
const COMMENTS_PANEL_TITLE_RE =
  /^(?:[\d.,\s]*)?(comentarios?|comments?|commentaires?|kommentare?)$/i;

export function isCommentsPanelOpen(nodes: UiNode[]): boolean {
  return nodes.some((n) => COMMENTS_PANEL_TITLE_RE.test(n.text.trim()));
}

/**
 * Count how many POSTED items (nodes rendered in the comments list — anything
 * that is NOT the input `EditText`) currently match our text. Comparing this
 * count *before* vs *after* the send tap is the definitive, screenshot-free
 * proof of publication:
 *   - foreign-safe: a stranger's comment bumping the panel count doesn't match
 *     our text, so it never counts;
 *   - duplicate-safe: if the avatar had already posted this exact text, the
 *     pre-existing copy is in the baseline, so only a genuinely NEW copy raises
 *     the count.
 * TikTok drops the just-sent comment at the top of the list as a TextView.
 */
export function countPostedMatches(nodes: UiNode[], text: string): number {
  return nodes.filter(
    (n) => n.className !== EDIT_TEXT_CLASS && normalizedIncludes(n.text, text),
  ).length;
}

/**
 * Text/desc markers of interstitials that slide over the flow (add-phone,
 * enable-notifications, signup nudges). We only look for a dismiss affordance
 * when one of these is on screen — crucially NOT when the comments panel is
 * open, whose own "Close" button must never be tapped.
 */
const INTERSTITIAL_MARKERS = [
  "add phone",
  "add your phone",
  "ajoute ton numéro",
  "ajouter un numéro",
  "ton numéro de téléphone",
  "añade tu número",
  "añadir número",
  "turn on notifications",
  "activer les notifications",
  "enable notifications",
];

const DISMISS_LABELS = [
  "not now",
  "plus tard",
  "ahora no",
  "später",
  "maybe later",
  "skip",
  "passer",
  "ignorer",
  "close",
  "cerrar",
  "fermer",
  "schließen",
];

/**
 * When a recognised interstitial is present, return a tap point for its
 * dismiss/skip/close affordance; otherwise null. Returns null when the
 * comments panel is open so we never close the panel by mistake.
 */
export function findInterstitialDismiss(nodes: UiNode[]): Point | null {
  if (isCommentsPanelOpen(nodes)) return null;

  const haystack = nodes
    .map((n) => `${n.contentDesc} ${n.text}`.toLowerCase())
    .join(" ");
  if (!INTERSTITIAL_MARKERS.some((m) => haystack.includes(m))) return null;

  for (const node of nodes) {
    const label = `${node.contentDesc} ${node.text}`.toLowerCase();
    if (DISMISS_LABELS.some((d) => label.includes(d))) {
      const center = nodeCenter(node);
      if (center) return center;
    }
  }
  return null;
}

/**
 * Normalized substring test used for typed-text verification. TikTok trims and
 * pads the field (we observed a leading space), long comments may be visually
 * truncated, and emoji can round-trip differently — so we compare a
 * whitespace-collapsed prefix rather than requiring an exact match.
 */
function normalizedIncludes(
  haystack: string,
  needle: string,
  minChars = 20,
): boolean {
  const h = normalizeWhitespace(haystack);
  const n = normalizeWhitespace(needle);
  if (n.length === 0) return false;
  if (h.length === 0) return false;
  const prefix = n.slice(0, Math.min(n.length, minChars));
  return h.includes(prefix) || n.includes(h);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
