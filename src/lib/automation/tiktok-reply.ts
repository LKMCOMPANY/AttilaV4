/**
 * Post a comment on a TikTok video through the native app — on the engine.
 *
 * Every step is decided from the accessibility tree read through the Control
 * API v2 (`src/lib/engine`): the screen is classified before any gesture,
 * elements are reached by named selectors (never a coordinate), typing goes
 * through ADBKeyboard only, and success is a POSITIVE signal read back after
 * the send — our comment as a posted item, or the exact count moving by one.
 * "Cannot verify" is a failure (AGENTS.md hard rules 3, 6; measured 9/09/2026).
 *
 * Pre-conditions enforced by the caller (`pipeline/executor`):
 *   - container fully booted (`ensureContainerReady`)
 *   - original IME captured for restore in the surrounding try/finally
 */

import {
  fetchControlApiVersion,
  fetchPackageInfo,
  fetchTimezoneLocale,
  screenshot,
  shell,
  shellSafe,
} from "@/lib/box-api";
import { ensureRtlBaseDirection } from "@/lib/text/bidi";
import { clickNode, clickTarget, pressBack, typeIntoField } from "@/lib/engine/actor";
import type { DeviceRef } from "@/lib/engine/device";
import { readTree, readTreeAfterGesture } from "@/lib/engine/reader";
import { editTexts, type CompactTree, type TreeNode } from "@/lib/engine/ui/compact-tree";
import {
  classifyScreen,
  commentsTitleNode,
  findSafeAffordance,
  SAFE_REACTION,
  type ScreenState,
} from "@/lib/engine/ui/screen-state";
import { resolveInTree, type SelectorContext } from "@/lib/engine/ui/selectors";
import { commentVerdict, parseCount, type ParsedCount } from "@/lib/engine/verifier";
import {
  androidDeepLink,
  getCurrentFocus,
  grantAppPermissions,
  isPackageInstalled,
  relaunchUntilFocus,
  sleep,
  wakeDevice,
  waitForSystemReady,
} from "./adb-helpers";
import { encodeJobError, JobError } from "./errors";
import { WATCHED_PACKAGES } from "@/lib/maintenance/app-versions.mjs";

const TIKTOK_PACKAGE = WATCHED_PACKAGES.tiktok;

/** Pre-granted so no runtime-permission dialog steals focus mid-flow (best-effort). */
const TIKTOK_PERMISSIONS = [
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
] as const;

// An expired session routes the deep link to TikTok's login package; the focus
// string names the activity verbatim, before any tree is readable.
const TIKTOK_AUTH_ACTIVITY_RE = /\.account\.login\.|SignUpActivity|LoginActivity/;

const TIMING = {
  afterForceStop: 800,
  systemReadyMs: 30_000,
  videoSettle: 6_000,
  launchAttempts: 3,
  foregroundTimeoutMs: 22_000,
  afterPanelOpen: 2_000,
  afterFieldFocus: 1_000,
  afterType: 1_500,
  beforeSend: 1_000,
  afterSend: 2_500,
  settleRounds: 4,
  settleWaitMs: 1_500,
} as const;

export interface TikTokReplyResult {
  success: boolean;
  source: Buffer;
  proof: Buffer;
  error?: string;
  durationMs: number;
}

function ttLog(dbId: string, step: string, data?: Record<string, unknown>) {
  console.log(`[TikTok-Reply][${dbId}] ${step}`, data ? JSON.stringify(data) : "");
}

export async function postTikTokComment(
  tunnelHostname: string,
  dbId: string,
  videoUrl: string,
  text: string,
): Promise<TikTokReplyResult> {
  const start = Date.now();
  ttLog(dbId, "postTikTokComment START", { videoUrl, textPreview: text.slice(0, 60) });

  let source: Buffer = Buffer.alloc(0);
  let proof: Buffer = Buffer.alloc(0);

  try {
    if (!videoUrl || !videoUrl.trim()) {
      throw new JobError("ui_unexpected", "Empty video URL — pipeline produced a job without a deep link target");
    }
    if (!(await isPackageInstalled(tunnelHostname, dbId, TIKTOK_PACKAGE))) {
      throw new JobError("device_setup_required", `TikTok app (${TIKTOK_PACKAGE}) not installed on device`);
    }

    const { dev, ctx } = await prepareDevice(tunnelHostname, dbId);
    await grantAppPermissions(tunnelHostname, dbId, TIKTOK_PACKAGE, TIKTOK_PERMISSIONS);
    await wakeDevice(tunnelHostname, dbId);
    await waitForSystemReady(tunnelHostname, dbId, TIMING.systemReadyMs);

    await openVideo(dev, videoUrl);

    // Gate 1 — the video screen, with every dismissable dialog out of the way.
    const feed = await settleOnVideo(dev);
    const baseline = commentCountOnFeed(feed);
    source = await screenshot(tunnelHostname, dbId);

    // Gate 2 — the comments panel is proven open before anything is typed.
    const panel = await openComments(dev, ctx, feed);
    const beforeMatches = countPostedMatches(panel, text);

    // Compose — focus the field, swap the IME, refocus, type. The tree may not
    // echo the typed text even on a fresh agent (measured on 44.9.3), so the
    // decisive checks come after the send; the enabled send button is the
    // pre-send signal.
    const field = await focusCommentField(dev, ctx, panel);
    await typeIntoField(dev, field, ensureRtlBaseDirection(text));
    await sleep(TIMING.afterType);
    const { tree: composed } = await readTree(dev);
    const send = resolveSendButton(composed, ctx, field);
    if (!send) {
      throw new JobError("ui_unexpected", "Comment composer open but no send button found — nothing was sent");
    }
    ttLog(dbId, "proof screenshot (composer + text, evidence only)");
    proof = await screenshot(tunnelHostname, dbId);
    await sleep(TIMING.beforeSend);

    // Send and verify: posted item or exact count +1, else a typed failure.
    const clicked = await clickNode(dev, send);
    if (!clicked.clicked) throw new JobError("ui_unexpected", "Send button did not accept the click");
    const verified = await verifyPosted(dev, ctx, text, baseline, beforeMatches, composed.hash);
    if (!verified.ok) throw verified.error;

    const liveShot = await screenshot(tunnelHostname, dbId).catch(() => Buffer.alloc(0));
    if (liveShot.length > 0) proof = liveShot;
    await shellSafe(tunnelHostname, dbId, "input keyevent 4");

    const durationMs = Date.now() - start;
    ttLog(dbId, "postTikTokComment SUCCESS", { durationMs, signal: verified.signal, sourceBytes: source.length, proofBytes: proof.length });
    return { success: true, source, proof, durationMs };
  } catch (err) {
    const error = encodeJobError(err);
    const durationMs = Date.now() - start;
    // Honest evidence: the actual end state, never a composer shot that looks like success.
    const endState = await screenshot(tunnelHostname, dbId).catch(() => Buffer.alloc(0));
    if (endState.length > 0) proof = endState;
    ttLog(dbId, "postTikTokComment FAILED", { error, durationMs, sourceBytes: source.length, proofBytes: proof.length });
    return { success: false, source, proof, error, durationMs };
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** Agent line, TikTok build and locale — what the reader and selectors need. */
async function prepareDevice(
  tunnelHostname: string,
  dbId: string,
): Promise<{ dev: DeviceRef; ctx: SelectorContext }> {
  const [version, packages, tz] = await Promise.all([
    fetchControlApiVersion(tunnelHostname, dbId),
    fetchPackageInfo(tunnelHostname, dbId, [TIKTOK_PACKAGE]).catch(() => []),
    fetchTimezoneLocale(tunnelHostname, dbId).catch(() => null),
  ]);
  const tiktok = packages.find((p) => p.package_name === TIKTOK_PACKAGE);
  const dev: DeviceRef = {
    tunnelHostname,
    dbId,
    agentLine: version?.agentLine ?? null,
    locale: tz?.locale ?? null,
  };
  const ctx: SelectorContext = { versionCode: tiktok?.version_code ?? null, locale: tz?.locale ?? null };
  ttLog(dbId, "device prepared", { agentLine: dev.agentLine, tiktok: tiktok?.version_name ?? null, locale: ctx.locale });
  return { dev, ctx };
}

/** Cold-start on the exact video (canonical URL, package-qualified), re-firing a swallowed launch. */
async function openVideo(dev: DeviceRef, videoUrl: string): Promise<void> {
  await shell(dev.tunnelHostname, dev.dbId, `am force-stop ${TIKTOK_PACKAGE}`);
  await sleep(TIMING.afterForceStop);

  const foregrounded = await relaunchUntilFocus(
    dev.tunnelHostname,
    dev.dbId,
    androidDeepLink(videoUrl, TIKTOK_PACKAGE),
    TIKTOK_PACKAGE,
    {
      attempts: TIMING.launchAttempts,
      perAttemptMs: TIMING.foregroundTimeoutMs,
      onRetry: (n) => ttLog(dev.dbId, `TikTok not foreground — re-firing deep link (attempt ${n + 1})`),
    },
  );
  if (!foregrounded) {
    throw new JobError("app_not_ready", `TikTok did not reach the foreground after ${TIMING.launchAttempts} deep-link attempts`);
  }
  const focus = await getCurrentFocus(dev.tunnelHostname, dev.dbId).catch(() => "");
  if (focus && TIKTOK_AUTH_ACTIVITY_RE.test(focus)) {
    throw new JobError("account_logged_out", "TikTok routed the deep link to its login screen — session expired, operator must sign in again");
  }
  await sleep(TIMING.videoSettle);
}

/**
 * Read, classify, react — until the video screen is the one on screen.
 * Dismissable dialogs get their safe reaction (never OK / Allow / Link / Log
 * in); security states throw the typed error the operator needs; anything
 * unknown is failed as `ui_unexpected` (the bounded vision agent takes over
 * in phase 2). A working screen that is not the video (profile, search, an
 * open sheet) is backed out of once per round.
 */
async function settleOnVideo(dev: DeviceRef): Promise<CompactTree> {
  let lastState: ScreenState = "unknown";
  for (let round = 0; round < TIMING.settleRounds; round++) {
    const { tree } = await readTree(dev);
    const c = classifyScreen(tree, "tiktok");
    lastState = c.state;
    ttLog(dev.dbId, "screen", { state: c.state, evidence: c.evidence, round });
    if (c.state === "feed_ok") return tree;

    const reaction = SAFE_REACTION[c.state];
    if (reaction === "stop") throw stopError(c.state, c.evidence);
    if (reaction === "reread") {
      await sleep(TIMING.settleWaitMs);
      continue;
    }
    const affordance = reaction === "proceed" || reaction === "back" ? null : findSafeAffordance(c.state, tree.nodes);
    if (affordance) {
      ttLog(dev.dbId, "dismissing", { state: c.state, via: affordance.text || affordance.contentDesc });
      await clickNode(dev, affordance);
    } else {
      await pressBack(dev);
    }
    await sleep(TIMING.settleWaitMs);
  }
  throw new JobError("ui_unexpected", `Screen never settled on the video (last state: ${lastState})`);
}

function stopError(state: ScreenState, evidence: string): JobError {
  switch (state) {
    case "logged_out":
      return new JobError("account_logged_out", `TikTok session expired or no avatar logged in on this device (${evidence})`);
    case "content_unavailable":
      return new JobError("content_unavailable", `Video deleted, private or account gone — skip this post (${evidence})`);
    case "network_error":
      return new JobError("network_unavailable", `TikTok cannot load content on this device — proxy down or exit IP blocked (${evidence})`);
    case "bouncer":
      return new JobError("account_captcha", `Security challenge on screen — operator escalation (${evidence})`);
    case "version_wall":
      return new JobError("device_setup_required", `App build refused by the platform — update the APK (${evidence})`);
    default:
      return new JobError("ui_unexpected", `Blocking screen ${state} (${evidence})`);
  }
}

/** The exact comment count carried by the feed's comments button, when shown. */
function commentCountOnFeed(feed: CompactTree): ParsedCount | null {
  const target = resolveInTree("tiktok.comments_button", feed, { locale: null });
  return target ? parseCount(target.node.contentDesc) : null;
}

/**
 * Open the comments sheet and PROVE it is up. One click per attempt, then a
 * read — never a BACK here (it would leave the video), and never a re-click
 * on an open sheet (it closes it). A dialog that pops over the sheet is
 * dismissed with its safe affordance.
 */
async function openComments(dev: DeviceRef, ctx: SelectorContext, feed: CompactTree): Promise<CompactTree> {
  let current = feed;
  for (let attempt = 0; attempt < 3; attempt++) {
    const opened = await clickTarget(dev, current, "tiktok.comments_button", ctx);
    if (!opened.clicked) {
      throw new JobError("app_not_ready", "Comments button not found on the video screen — nothing typed, safe to retry");
    }
    await sleep(TIMING.afterPanelOpen);
    const read = await readTreeAfterGesture(dev, { previousHash: current.hash, expectChange: true });
    const c = classifyScreen(read.tree, "tiktok");
    ttLog(dev.dbId, "after comments click", { state: c.state, evidence: c.evidence, attempt, stale: read.stale });
    if (c.state === "comments_panel") return read.tree;
    if (SAFE_REACTION[c.state] === "stop") throw stopError(c.state, c.evidence);
    const affordance = findSafeAffordance(c.state, read.tree.nodes);
    if (affordance) {
      await clickNode(dev, affordance);
      await sleep(TIMING.settleWaitMs);
      current = (await readTree(dev)).tree;
      continue;
    }
    if (c.state !== "feed_ok") {
      throw new JobError("ui_unexpected", `Unexpected screen after the comments click: ${c.state} (${c.evidence})`);
    }
    current = read.tree;
  }
  throw new JobError("app_not_ready", "Comments sheet never opened after 3 clicks — nothing typed, safe to retry");
}

/**
 * Focus the comment field and return the node to refocus before typing: once
 * clicked, the collapsed bar becomes the expanded composer's EditText (same
 * resource id, new bounds), which `typeIntoField` clicks again after the IME swap.
 */
async function focusCommentField(dev: DeviceRef, ctx: SelectorContext, panel: CompactTree): Promise<TreeNode> {
  const first = await clickTarget(dev, panel, "tiktok.comment_field", ctx);
  if (!first.clicked || !first.node) {
    throw new JobError("app_not_ready", "Comment field not found in the comments panel — nothing typed, safe to retry");
  }
  await sleep(TIMING.afterFieldFocus);
  const after = await readTreeAfterGesture(dev, { previousHash: panel.hash, expectChange: true, noKick: true });
  return editTexts(after.tree.nodes).find((n) => n.focused) ?? first.node;
}

/**
 * The send button: the versioned id when known, else the enabled clickable
 * Button whose description is an unresolved resource string and that sits on
 * the composer's row, right of the field's left edge (measured: `cj9` / `cjh`,
 * desc `@2131…`, below-right of the expanded field).
 */
function resolveSendButton(tree: CompactTree, ctx: SelectorContext, field: TreeNode): TreeNode | null {
  const known = resolveInTree("tiktok.send_button", tree, ctx);
  if (known) return known.node;
  const fieldLeft = field.bounds?.left ?? 0;
  return (
    tree.nodes.find(
      (n) =>
        n.className === "android.widget.Button" &&
        n.clickable &&
        n.enabled &&
        /^@\d{8,}$/.test(n.contentDesc.trim()) &&
        (n.bounds?.left ?? 0) > fieldLeft,
    ) ?? null
  );
}

function countPostedMatches(tree: CompactTree, text: string): number {
  const needle = text.replace(/\s+/g, " ").trim().slice(0, 20).toLowerCase();
  return tree.nodes.filter(
    (n) => n.className !== "android.widget.EditText" && n.text.replace(/\s+/g, " ").toLowerCase().includes(needle),
  ).length;
}

/**
 * Publication check. First on the tree read after the send; if that tree is
 * stale or silent, through a window transition (close the panel, open it
 * again — a window-state change refreshes the tree on every agent line).
 */
async function verifyPosted(
  dev: DeviceRef,
  ctx: SelectorContext,
  text: string,
  baseline: ParsedCount | null,
  beforeMatches: number,
  composedHash: string,
): Promise<{ ok: true; signal: string } | { ok: false; error: JobError }> {
  const first = await readTreeAfterGesture(dev, {
    previousHash: composedHash,
    expectChange: true,
    noKick: true,
    settleMs: TIMING.afterSend,
  });
  let verdict = commentVerdict(first.tree, text, { before: baseline, after: panelCount(first.tree) });
  const newMatches = countPostedMatches(first.tree, text) > beforeMatches;
  if (verdict.verified && (verdict.signal !== "posted_item" || newMatches)) {
    return { ok: true, signal: verdict.signal };
  }
  if (verdict.signal === "text_stuck") {
    return { ok: false, error: new JobError("rate_limited", "Send did not go through — the comment text is still in the composer") };
  }

  // Window transition: close and reopen the panel, then read the list fresh.
  ttLog(dev.dbId, "verification through panel reopen", { firstSignal: verdict.signal, stale: first.stale });
  await pressBack(dev);
  await sleep(TIMING.settleWaitMs);
  const feed = await settleOnVideo(dev);
  const afterCount = commentCountOnFeed(feed);
  let panel: CompactTree;
  try {
    panel = await openComments(dev, ctx, feed);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: new JobError("ui_unexpected", `Could not reopen the comments panel to verify the publication (${detail})`) };
  }
  verdict = commentVerdict(panel, text, { before: baseline, after: afterCount ?? panelCount(panel) });
  if (verdict.verified && (verdict.signal !== "posted_item" || countPostedMatches(panel, text) > beforeMatches)) {
    return { ok: true, signal: `${verdict.signal}_after_reopen` };
  }
  if (verdict.signal === "unreadable") {
    return { ok: false, error: new JobError("ui_unexpected", "Could not read the comments list after sending — publication unverifiable") };
  }
  return {
    ok: false,
    error: new JobError("rate_limited", `Composer cleared but the comment never appeared as posted (${verdict.signal}) — silent drop or throttle`),
  };
}

/** Exact count from the sheet title ("13,816 comments", "Comentarios 9"), when present. */
function panelCount(tree: CompactTree): ParsedCount | null {
  const title = commentsTitleNode(tree.nodes);
  return title ? parseCount(title.text) : null;
}
