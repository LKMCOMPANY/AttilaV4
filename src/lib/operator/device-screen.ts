import type { RequestSession } from "@/lib/auth/session";
import { fetchScreenshotJpeg } from "@/lib/box-api";
import { resolveDeviceAccess } from "@/lib/devices/access";
import type { DeviceRef } from "@/lib/engine/device";
import { readTree, TreeUnreadableError, type TreeRead } from "@/lib/engine/reader";
import { packagesOf, type CompactTree, type TreeNode } from "@/lib/engine/ui/compact-tree";
import { classifyScreen, SAFE_REACTION, type Classification, type SocialApp } from "@/lib/engine/ui/screen-state";
import { WATCHED_PACKAGES } from "@/lib/maintenance/app-versions.mjs";

/**
 * The operator's eyes through the API: what a running device shows right now
 * — the accessibility tree read by the engine's reader (v2 with the in-guest
 * fallback), classified by the engine's own taxonomy, compacted to the nodes
 * a human or a model can act on, and optionally the screenshot.
 *
 * Nothing here acts on the device. It is the read half of the "operator's
 * hands" the macOS MCP server exposes; the write half is `device-input.ts`.
 */

/** Nodes worth listing: anything a finger or a reader could target. */
export const DEFAULT_MAX_NODES = 120;
export const MAX_NODES_CEILING = 400;

export interface ScreenNode {
  /** Position in this list (1-based) — the handle a caller quotes back. */
  index: number;
  class: string;
  text: string | null;
  content_desc: string | null;
  resource_id: string | null;
  package: string;
  clickable: boolean;
  focused: boolean;
  scrollable: boolean;
  editable: boolean;
  bounds: [number, number, number, number] | null;
  center: [number, number] | null;
}

export interface DeviceScreen {
  device_id: string;
  db_id: string;
  read_at: string;
  source: TreeRead["source"];
  duration_ms: number;
  width: number;
  height: number;
  /** The social app on top, when one is. */
  app: SocialApp | null;
  top_package: string | null;
  state: Classification["state"];
  evidence: string;
  /** What the engine itself would do on that state — `stop` means hands off. */
  safe_reaction: (typeof SAFE_REACTION)[Classification["state"]];
  node_count: number;
  nodes: ScreenNode[];
  /** JPEG, base64, when asked for. */
  screenshot_jpeg_base64?: string;
}

export interface DeviceScreenResult {
  error: string | null;
  screen?: DeviceScreen;
}

export interface ReadScreenOptions {
  includeScreenshot?: boolean;
  maxNodes?: number;
}

/** The app a package belongs to, for the classifier. */
export function socialAppOf(packages: readonly string[]): SocialApp | null {
  if (packages.includes(WATCHED_PACKAGES.tiktok)) return "tiktok";
  if (packages.includes(WATCHED_PACKAGES.twitter)) return "twitter";
  return null;
}

/** Classify with the app on top; without a social app the state is `unknown`. */
export function classifyForOperator(tree: CompactTree): Classification & { app: SocialApp | null } {
  const packages = packagesOf(tree.nodes);
  const app = socialAppOf(packages);
  if (!app) {
    return {
      app: null,
      state: tree.nodes.length === 0 ? "empty_tree" : "unknown",
      evidence: tree.nodes.length === 0 ? "no nodes" : `no social app on top (${packages.slice(0, 3).join(", ") || "no package"})`,
      topPackage: packages[0] ?? null,
    };
  }
  return { app, ...classifyScreen(tree, app) };
}

function isEditable(node: TreeNode): boolean {
  return node.className.endsWith("EditText") || node.className.includes("EditText");
}

/** Keep the nodes a hand can use, in screen order, capped (0 = the state alone). */
export function compactNodes(tree: CompactTree, maxNodes = DEFAULT_MAX_NODES): ScreenNode[] {
  const cap = Math.min(Math.max(0, maxNodes), MAX_NODES_CEILING);
  const worthListing = tree.nodes.filter(
    (n) => n.clickable || n.focusable || n.scrollable || isEditable(n) || n.text.length > 0 || n.contentDesc.length > 0,
  );
  return worthListing.slice(0, cap).map((n, position) => ({
    index: position + 1,
    class: n.className.split(".").pop() ?? n.className,
    text: n.text || null,
    content_desc: n.contentDesc || null,
    resource_id: n.resourceId || null,
    package: n.packageName,
    clickable: n.clickable,
    focused: n.focused,
    scrollable: n.scrollable,
    editable: isEditable(n),
    bounds: n.bounds ? [n.bounds.left, n.bounds.top, n.bounds.right, n.bounds.bottom] : null,
    center: n.bounds ? [Math.round((n.bounds.left + n.bounds.right) / 2), Math.round((n.bounds.top + n.bounds.bottom) / 2)] : null,
  }));
}

/** Shape one read into the operator document. */
export function describeScreen(
  dev: DeviceRef & { deviceId: string },
  read: TreeRead,
  maxNodes: number,
  screenshot?: Buffer,
): DeviceScreen {
  const classification = classifyForOperator(read.tree);
  const screen: DeviceScreen = {
    device_id: dev.deviceId,
    db_id: dev.dbId,
    read_at: new Date().toISOString(),
    source: read.source,
    duration_ms: read.durationMs,
    width: read.tree.width,
    height: read.tree.height,
    app: classification.app,
    top_package: classification.topPackage,
    state: classification.state,
    evidence: classification.evidence,
    safe_reaction: SAFE_REACTION[classification.state],
    node_count: read.tree.nodes.length,
    nodes: compactNodes(read.tree, maxNodes),
  };
  if (screenshot && screenshot.length > 0) {
    screen.screenshot_jpeg_base64 = screenshot.toString("base64");
  }
  return screen;
}

/**
 * The device as the engine addresses it, plus the columns the reader needs
 * (agent line for the freshness rule, locale for the selectors). Refuses a
 * device that is not running — a stopped container has no screen.
 */
export async function resolveRunningDevice(
  ctx: RequestSession,
  deviceId: string,
): Promise<DeviceRef & { deviceId: string; accountId: string | null; boxId: string }> {
  const access = await resolveDeviceAccess(ctx, deviceId);
  const { data: row } = await ctx.supabase
    .from("devices")
    .select("state, agent_line, locale")
    .eq("id", access.deviceId)
    .single();
  if (row?.state !== "running") {
    throw new Error("Device is not running — start it first");
  }
  return {
    deviceId: access.deviceId,
    accountId: access.accountId,
    boxId: access.boxId,
    tunnelHostname: access.tunnelHostname,
    dbId: access.dbId,
    agentLine: (row?.agent_line as string | null) ?? null,
    locale: (row?.locale as string | null) ?? null,
  };
}

/**
 * Mark the operator's presence on the device: `devices.last_seen` is what
 * the slot arbiter reads to leave a device alone (`box-slots.ts`), and what
 * the reaper spares. Best effort — the read itself must not fail on it.
 */
export async function touchDevicePresence(ctx: RequestSession, deviceId: string): Promise<void> {
  await ctx.supabase.from("devices").update({ last_seen: new Date().toISOString() }).eq("id", deviceId);
}

export async function readDeviceScreenCore(
  ctx: RequestSession,
  deviceId: string,
  options: ReadScreenOptions = {},
): Promise<DeviceScreenResult> {
  try {
    const dev = await resolveRunningDevice(ctx, deviceId);
    const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
    const [read, screenshot] = await Promise.all([
      readTree(dev),
      options.includeScreenshot ? fetchScreenshotJpeg(dev.tunnelHostname, dev.dbId) : Promise.resolve(undefined),
    ]);
    await touchDevicePresence(ctx, dev.deviceId);
    return { error: null, screen: describeScreen(dev, read, maxNodes, screenshot) };
  } catch (err) {
    if (err instanceof TreeUnreadableError) {
      return { error: "The device's accessibility tree is unreadable right now (booting, or the agent is down). Retry in a few seconds." };
    }
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}
