/**
 * Parser for the Control API v2 `accessibility/dump_compact` text format.
 *
 * One node per line, indented two spaces per depth level:
 *
 *   Screen 1080x2340 rotation=0
 *   [0] android.widget.FrameLayout resource-id="android:id/content" package="…" enabled=true bounds=[0,0][1080,2340]
 *     [1] android.widget.Button text="941" resource-id="…:id/fms" package="…" clickable=true enabled=true bounds=[888,1421][1080,1447]
 *
 * Quoted attributes (`text`, `resource-id`, `package`, `content-desc`) come
 * first, boolean flags next (`clickable=true`, `NAF=true`, …), `bounds` last.
 * Pure function of the text — no device I/O — so it is unit-tested and shared
 * by the reader, the classifier and the verifier.
 */

import { createHash } from "node:crypto";

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TreeNode {
  depth: number;
  index: number;
  className: string;
  text: string;
  resourceId: string;
  contentDesc: string;
  packageName: string;
  clickable: boolean;
  enabled: boolean;
  focusable: boolean;
  focused: boolean;
  scrollable: boolean;
  selected: boolean;
  checked: boolean;
  longClickable: boolean;
  /** "Not Accessibility Friendly": clickable node without any label. */
  naf: boolean;
  bounds: Bounds | null;
}

export interface CompactTree {
  width: number;
  height: number;
  rotation: number;
  nodes: TreeNode[];
  /** SHA-1 of the raw text — two identical hashes mean the agent served the same tree. */
  hash: string;
  byteLength: number;
}

const HEADER_RE = /^Screen\s+(\d+)x(\d+)\s+rotation=(\d+)/;
const LINE_RE = /^(\s*)\[(\d+)\]\s+(\S+)(.*)$/;
const BOUNDS_RE = /\s+bounds=\[(\d+),(\d+)\]\[(\d+),(\d+)\]\s*$/;

const QUOTED_KEYS = ["text", "resource-id", "package", "content-desc", "hint"] as const;
const FLAG_KEYS = [
  "clickable",
  "enabled",
  "focusable",
  "focused",
  "scrollable",
  "selected",
  "checked",
  "checkable",
  "long-clickable",
  "password",
  "NAF",
] as const;

const KEY_ALTERNATION = [...QUOTED_KEYS, ...FLAG_KEYS, "bounds"].join("|");
// Lazy value followed by a lookahead to the next known key (or end of line):
// tolerates unescaped quotes inside captions and content descriptions.
const QUOTED_RE = new RegExp(
  `(${QUOTED_KEYS.join("|")})="(.*?)"(?=\\s+(?:${KEY_ALTERNATION})=|\\s*$)`,
  "g",
);
const FLAG_RE = new RegExp(`\\b(${FLAG_KEYS.join("|")})=(true|false)\\b`, "g");

// Bidi and zero-width control characters that TikTok and X prefix to some
// strings (e.g. "\u200e1109 comments"); stripped so matchers see clean text.
const INVISIBLE_RE = /[\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

function clean(value: string | undefined): string {
  return (value ?? "").replace(INVISIBLE_RE, "");
}

export function hashTreeText(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/** Parse a compact dump. An empty or header-only payload yields zero nodes. */
export function parseCompactTree(text: string): CompactTree {
  const lines = text.split("\n");
  const header = HEADER_RE.exec(lines[0] ?? "");
  const nodes: TreeNode[] = [];

  for (const line of lines.slice(header ? 1 : 0)) {
    const m = LINE_RE.exec(line.trimEnd());
    if (!m) continue;
    const [, indent, index, className, restRaw] = m;

    let rest = restRaw;
    let bounds: Bounds | null = null;
    const b = BOUNDS_RE.exec(rest);
    if (b) {
      bounds = { left: +b[1], top: +b[2], right: +b[3], bottom: +b[4] };
      rest = rest.slice(0, b.index);
    }

    const quoted: Record<string, string> = {};
    for (const q of rest.matchAll(QUOTED_RE)) quoted[q[1]] = q[2];
    const flags: Record<string, boolean> = {};
    for (const f of rest.matchAll(FLAG_RE)) flags[f[1]] = f[2] === "true";

    nodes.push({
      depth: Math.floor(indent.length / 2),
      index: Number(index),
      className,
      text: clean(quoted.text),
      resourceId: quoted["resource-id"] ?? "",
      contentDesc: clean(quoted["content-desc"]),
      packageName: quoted.package ?? "",
      clickable: flags.clickable ?? false,
      enabled: flags.enabled ?? false,
      focusable: flags.focusable ?? false,
      focused: flags.focused ?? false,
      scrollable: flags.scrollable ?? false,
      selected: flags.selected ?? false,
      checked: flags.checked ?? false,
      longClickable: flags["long-clickable"] ?? false,
      naf: flags.NAF ?? false,
      bounds,
    });
  }

  return {
    width: header ? Number(header[1]) : 0,
    height: header ? Number(header[2]) : 0,
    rotation: header ? Number(header[3]) : 0,
    nodes,
    hash: hashTreeText(text),
    byteLength: Buffer.byteLength(text, "utf8"),
  };
}

// ---------------------------------------------------------------------------
// Queries — the small vocabulary the classifier and verifier are written in
// ---------------------------------------------------------------------------

export function nodeCenter(node: TreeNode): { x: number; y: number } | null {
  if (!node.bounds) return null;
  const { left, top, right, bottom } = node.bounds;
  if (right <= left || bottom <= top) return null;
  return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
}

export function findByResourceId(nodes: readonly TreeNode[], resourceId: string): TreeNode[] {
  return nodes.filter((n) => n.resourceId === resourceId);
}

export function findByText(nodes: readonly TreeNode[], text: string): TreeNode[] {
  return nodes.filter((n) => n.text === text);
}

/** Case-insensitive substring match over `content-desc`. */
export function findByDescContains(nodes: readonly TreeNode[], needle: string): TreeNode[] {
  const lower = needle.toLowerCase();
  return nodes.filter((n) => n.contentDesc.toLowerCase().includes(lower));
}

/** Case-insensitive substring match over `text`. */
export function findByTextContains(nodes: readonly TreeNode[], needle: string): TreeNode[] {
  const lower = needle.toLowerCase();
  return nodes.filter((n) => n.text.toLowerCase().includes(lower));
}

export function editTexts(nodes: readonly TreeNode[]): TreeNode[] {
  return nodes.filter((n) => n.className === "android.widget.EditText");
}

/** Distinct packages present in the tree, in first-seen order (top window first). */
export function packagesOf(nodes: readonly TreeNode[]): string[] {
  const seen: string[] = [];
  for (const n of nodes) {
    if (n.packageName && !seen.includes(n.packageName)) seen.push(n.packageName);
  }
  return seen;
}

/**
 * All visible strings (text + content-desc) lower-cased and joined — the
 * haystack the screen classifier scans for its markers.
 */
export function visibleText(nodes: readonly TreeNode[]): string {
  const parts: string[] = [];
  for (const n of nodes) {
    if (n.text) parts.push(n.text);
    if (n.contentDesc) parts.push(n.contentDesc);
  }
  return parts.join("\n").toLowerCase();
}

/** Whitespace-collapsed prefix containment, tolerant to platform trimming. */
export function textMatches(haystack: string, needle: string, minChars = 20): boolean {
  const h = haystack.replace(/\s+/g, " ").trim();
  const n = needle.replace(/\s+/g, " ").trim();
  if (!h || !n) return false;
  const prefix = n.slice(0, Math.min(n.length, minChars));
  return h.includes(prefix) || n.includes(h);
}
