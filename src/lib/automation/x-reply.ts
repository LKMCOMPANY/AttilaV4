/**
 * Post a reply on X through the native Android app — on the engine.
 *
 * The 18 April 2026 flow accepted a reply when the focus came back to
 * `TweetDetailActivity`; on 9 September 2026 that produced a `done` while the
 * post had never loaded ("Cannot retrieve posts at this time"). This flow
 * reads the tree before every gesture, reaches elements by named selectors
 * (X ids carry no package prefix: `post-detail-reply-text-field`), types
 * through ADBKeyboard only, and calls success only when OUR reply is read
 * back as a posted node in the conversation and the field is empty again.
 * "Cannot verify" is a failure. TikHub's deferred pass stays the off-device
 * arbiter (`verification` column).
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
} from "@/lib/box-api";
import { ensureRtlBaseDirection } from "@/lib/text/bidi";
import { clickNode, clickTarget, pressBack, scrollFeed, typeIntoField } from "@/lib/engine/actor";
import type { DeviceRef } from "@/lib/engine/device";
import { readTree, readTreeAfterGesture } from "@/lib/engine/reader";
import { editTexts, type CompactTree, type TreeNode } from "@/lib/engine/ui/compact-tree";
import { classifyScreen, findSafeAffordance, SAFE_REACTION, type ScreenState } from "@/lib/engine/ui/screen-state";
import type { SelectorContext } from "@/lib/engine/ui/selectors";
import { postedTextNode, textStillInField } from "@/lib/engine/verifier";
import {
  androidDeepLink,
  grantAppPermissions,
  isPackageInstalled,
  relaunchUntilFocus,
  sleep,
  wakeDevice,
  waitForSystemReady,
} from "./adb-helpers";
import { encodeJobError, JobError } from "./errors";
import { WATCHED_PACKAGES } from "@/lib/maintenance/app-versions.mjs";

const X_PACKAGE = WATCHED_PACKAGES.twitter;

/** Pre-granted so no runtime-permission dialog steals focus mid-reply (best-effort). */
const X_PERMISSIONS = [
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
] as const;

const TIMING = {
  afterForceStop: 800,
  systemReadyMs: 30_000,
  postSettle: 4_000,
  launchAttempts: 3,
  foregroundTimeoutMs: 15_000,
  afterFieldFocus: 1_000,
  afterType: 1_500,
  beforeSubmit: 1_200,
  afterSubmit: 3_000,
  settleRounds: 6,
  settleWaitMs: 1_500,
} as const;

export interface ReplyResult {
  success: boolean;
  source: Buffer;
  proof: Buffer;
  error?: string;
  durationMs: number;
}

function xLog(dbId: string, step: string, data?: Record<string, unknown>) {
  console.log(`[X-Reply][${dbId}] ${step}`, data ? JSON.stringify(data) : "");
}

export async function postReply(
  tunnelHostname: string,
  dbId: string,
  tweetUrl: string,
  text: string,
): Promise<ReplyResult> {
  const start = Date.now();
  xLog(dbId, "postReply START", { tweetUrl, textPreview: text.slice(0, 60) });

  let source: Buffer = Buffer.alloc(0);
  let proof: Buffer = Buffer.alloc(0);

  try {
    if (!tweetUrl || !tweetUrl.trim()) {
      throw new JobError("ui_unexpected", "Empty tweet URL — pipeline produced a job without a deep link target");
    }
    if (!(await isPackageInstalled(tunnelHostname, dbId, X_PACKAGE))) {
      throw new JobError("device_setup_required", `X app (${X_PACKAGE}) not installed on device`);
    }

    const { dev, ctx } = await prepareDevice(tunnelHostname, dbId);
    await grantAppPermissions(tunnelHostname, dbId, X_PACKAGE, X_PERMISSIONS);
    await wakeDevice(tunnelHostname, dbId);
    await waitForSystemReady(tunnelHostname, dbId, TIMING.systemReadyMs);

    await openPost(dev, tweetUrl);

    // Gate 1 — the post detail is on screen, dialogs dismissed, no wall.
    const detail = await settleOnPostDetail(dev);
    source = await screenshot(tunnelHostname, dbId);

    // Compose — focus the reply field, swap the IME, refocus, type. The inline
    // composer is an in-window change: on the 1.1.3 line the tree only shows
    // it after a kick (X's composer survives one, unlike TikTok's).
    const field = await focusReplyField(dev, ctx, detail);
    await typeIntoField(dev, field, ensureRtlBaseDirection(text));
    await sleep(TIMING.afterType);
    let composed = (await readTreeAfterGesture(dev, { previousHash: detail.hash, expectChange: true })).tree;
    xLog(dbId, "typed", { visibleInField: textStillInField(composed, text) });
    proof = await screenshot(tunnelHostname, dbId);
    await sleep(TIMING.beforeSubmit);

    // Submit through the button carrying the word (the reply ICON carries the
    // same word as content-desc; the exact @text selector picks the button).
    // When the inline button is not readable, the full composer is a window of
    // its own — fresh tree on every agent line — and carries the typed text.
    let submitted = await clickTarget(dev, composed, "x.reply_button", ctx);
    if (!submitted.clicked) {
      composed = await openFullComposer(dev, composed);
      submitted = await clickTarget(dev, composed, "x.reply_button", ctx);
    }
    if (!submitted.clicked) {
      throw new JobError("ui_unexpected", "Reply button not found with the composer open — nothing was sent");
    }

    // Verify — our reply read back as a posted node, the field empty again.
    const verified = await verifyPosted(dev, text, composed.hash);
    if (!verified.ok) throw verified.error;

    const postedShot = await screenshot(tunnelHostname, dbId).catch(() => Buffer.alloc(0));
    if (postedShot.length > 0) proof = postedShot;

    const durationMs = Date.now() - start;
    xLog(dbId, "postReply SUCCESS", { durationMs, signal: verified.signal, sourceBytes: source.length, proofBytes: proof.length });
    return { success: true, source, proof, durationMs };
  } catch (err) {
    const error = encodeJobError(err);
    const durationMs = Date.now() - start;
    const endState = await screenshot(tunnelHostname, dbId).catch(() => Buffer.alloc(0));
    if (endState.length > 0) proof = endState;
    xLog(dbId, "postReply FAILED", { error, durationMs, sourceBytes: source.length, proofBytes: proof.length });
    return { success: false, source, proof, error, durationMs };
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function prepareDevice(
  tunnelHostname: string,
  dbId: string,
): Promise<{ dev: DeviceRef; ctx: SelectorContext }> {
  const [version, packages, tz] = await Promise.all([
    fetchControlApiVersion(tunnelHostname, dbId),
    fetchPackageInfo(tunnelHostname, dbId, [X_PACKAGE]).catch(() => []),
    fetchTimezoneLocale(tunnelHostname, dbId).catch(() => null),
  ]);
  const x = packages.find((p) => p.package_name === X_PACKAGE);
  const dev: DeviceRef = { tunnelHostname, dbId, agentLine: version?.agentLine ?? null, locale: tz?.locale ?? null };
  const ctx: SelectorContext = { versionCode: x?.version_code ?? null, locale: tz?.locale ?? null };
  xLog(dbId, "device prepared", { agentLine: dev.agentLine, x: x?.version_name ?? null, locale: ctx.locale });
  return { dev, ctx };
}

/** Cold-start on the post (canonical URL, package-qualified), re-firing a swallowed launch. */
async function openPost(dev: DeviceRef, tweetUrl: string): Promise<void> {
  await shell(dev.tunnelHostname, dev.dbId, `am force-stop ${X_PACKAGE}`);
  await sleep(TIMING.afterForceStop);
  const foregrounded = await relaunchUntilFocus(
    dev.tunnelHostname,
    dev.dbId,
    androidDeepLink(tweetUrl, X_PACKAGE),
    X_PACKAGE,
    {
      attempts: TIMING.launchAttempts,
      perAttemptMs: TIMING.foregroundTimeoutMs,
      onRetry: (n) => xLog(dev.dbId, `X not foreground — re-firing deep link (attempt ${n + 1})`),
    },
  );
  if (!foregrounded) {
    throw new JobError("app_not_ready", `X did not reach the foreground after ${TIMING.launchAttempts} deep-link attempts`);
  }
  await sleep(TIMING.postSettle);
}

/**
 * Read, classify, react until the post detail is on screen. The version
 * wall, the bouncer, "Cannot retrieve posts" and the logged-out landing stop
 * the job with the category the operator needs; the Play Store sheet and the
 * payment error are backed out of; a home feed means the deep link did not
 * land (retryable, nothing typed).
 */
async function settleOnPostDetail(dev: DeviceRef): Promise<CompactTree> {
  let lastState: ScreenState = "unknown";
  let quietRounds = 0;
  for (let round = 0; round < TIMING.settleRounds; round++) {
    const { tree } = await readTree(dev);
    const c = classifyScreen(tree, "twitter");
    lastState = c.state;
    xLog(dev.dbId, "screen", { state: c.state, evidence: c.evidence, round });
    if (c.state === "post_detail") return tree;

    const reaction = SAFE_REACTION[c.state];
    if (reaction === "stop") throw stopError(c.state, c.evidence);
    if (c.state === "feed_ok") {
      throw new JobError("app_not_ready", "Deep link landed on the home feed, not the post — nothing typed, safe to retry");
    }
    if (reaction === "reread" || reaction === "vision") {
      // A tree with no markers that does not change is not a slow load: X
      // shows full-screen Premium upsells with almost no accessibility text
      // (measured 9/09 on 12.21.1). One BACK clears them; log what we saw.
      quietRounds++;
      if (quietRounds >= 2) {
        xLog(dev.dbId, "quiet screen — backing out", { nodes: tree.nodes.length, labels: labelsOf(tree) });
        await pressBack(dev);
        quietRounds = 0;
      }
      await sleep(TIMING.settleWaitMs);
      continue;
    }
    quietRounds = 0;
    const affordance = reaction === "proceed" || reaction === "back" ? null : findSafeAffordance(c.state, tree.nodes);
    if (affordance) {
      xLog(dev.dbId, "dismissing", { state: c.state, via: affordance.text || affordance.contentDesc });
      await clickNode(dev, affordance);
    } else {
      await pressBack(dev);
    }
    await sleep(TIMING.settleWaitMs);
  }
  throw new JobError("ui_unexpected", `Screen never settled on the post detail (last state: ${lastState})`);
}

/** Texts and descriptions of a small tree, for the step log. */
function labelsOf(tree: CompactTree): string[] {
  return tree.nodes
    .flatMap((n) => [n.text, n.contentDesc])
    .filter((s) => s.length > 0)
    .slice(0, 12);
}

function stopError(state: ScreenState, evidence: string): JobError {
  switch (state) {
    case "logged_out":
      return new JobError("account_logged_out", `X session expired or no avatar logged in on this device (${evidence})`);
    case "content_unavailable":
      return new JobError("content_unavailable", `Post deleted, private, suspended or geo-blocked — skip (${evidence})`);
    case "network_error":
      return new JobError("network_unavailable", `X cannot load content on this device — proxy down or exit IP blocked (${evidence})`);
    case "bouncer":
      return new JobError("account_captcha", `Security verification on screen — operator escalation (${evidence})`);
    case "version_wall":
      return new JobError("device_setup_required", `X build refused by the platform — update the APK (${evidence})`);
    default:
      return new JobError("ui_unexpected", `Blocking screen ${state} (${evidence})`);
  }
}

/**
 * Focus the reply field and return the node to refocus before typing. The
 * composer opens inline (the field grows in place) or as a full-screen
 * activity; either way the focused EditText is the target.
 */
async function focusReplyField(dev: DeviceRef, ctx: SelectorContext, detail: CompactTree): Promise<TreeNode> {
  const first = await clickTarget(dev, detail, "x.reply_field", ctx);
  if (!first.clicked || !first.node) {
    throw new JobError("app_not_ready", "Reply field not found on the post detail — nothing typed, safe to retry");
  }
  await sleep(TIMING.afterFieldFocus);
  const after = await readTreeAfterGesture(dev, { previousHash: detail.hash, expectChange: true, noKick: true });
  return editTexts(after.tree.nodes).find((n) => n.focused) ?? first.node;
}

const FULL_COMPOSER_DESC = ["open full composer", "ouvrir l'éditeur", "abrir el editor completo"];

/**
 * Expand the inline composer into the full-screen one (its own window, so
 * the tree is fresh on every agent line); the typed text carries over.
 */
async function openFullComposer(dev: DeviceRef, current: CompactTree): Promise<CompactTree> {
  const expand = current.nodes.find((n) => FULL_COMPOSER_DESC.some((d) => n.contentDesc.toLowerCase().includes(d)));
  if (!expand) return current;
  xLog(dev.dbId, "opening the full composer");
  await clickNode(dev, expand);
  await sleep(TIMING.afterFieldFocus);
  return (await readTreeAfterGesture(dev, { previousHash: current.hash, expectChange: true })).tree;
}

/**
 * Publication check: our text present as a non-input node (the reply signed
 * with the avatar's name in the conversation) and no longer in any field.
 * One scroll down covers a reply that landed below the fold.
 */
async function verifyPosted(
  dev: DeviceRef,
  text: string,
  composedHash: string,
): Promise<{ ok: true; signal: string } | { ok: false; error: JobError }> {
  let read = await readTreeAfterGesture(dev, { previousHash: composedHash, expectChange: true, settleMs: TIMING.afterSubmit });
  if (textStillInField(read.tree, text)) {
    return { ok: false, error: new JobError("rate_limited", "Submit did not send — the reply text is still in the composer") };
  }
  if (postedTextNode(read.tree, text)) return { ok: true, signal: "posted_item" };

  await scrollFeed(dev, read.tree, { distance: 0.35 });
  read = await readTreeAfterGesture(dev, { previousHash: read.tree.hash, expectChange: true, settleMs: 1_200 });
  if (postedTextNode(read.tree, text)) return { ok: true, signal: "posted_item_after_scroll" };
  if (read.tree.nodes.length === 0) {
    return { ok: false, error: new JobError("ui_unexpected", "Could not read the conversation after sending — publication unverifiable") };
  }
  return {
    ok: false,
    error: new JobError("ui_unexpected", "Composer closed but the reply was not read back in the conversation — unverified, not counted as posted"),
  };
}
