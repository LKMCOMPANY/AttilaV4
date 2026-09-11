import { postTikTokComment } from "@/lib/automation/tiktok-reply";
import { postReply } from "@/lib/automation/x-reply";
import { clickTarget, openDeepLink, pressBack } from "@/lib/engine/actor";
import { readTreeAfterGesture, sleep, type TreeRead } from "@/lib/engine/reader";
import { findByDescContains, findByTextContains, type CompactTree } from "@/lib/engine/ui/compact-tree";
import { classifyScreen } from "@/lib/engine/ui/screen-state";
import { followState, followVerified, likeState, likeVerified } from "@/lib/engine/verifier";
import type { AvatarActionKind } from "@/types";
import { remainingBudget } from "../cluster/engage";
import { directedParamsSchema, parseTarget, type DirectedParams, type ParsedTarget } from "../directed";
import { recordAvatarAction } from "../ledger";
import { storeProof } from "../runner/proofs";
import { appFor, MAIN_STATES } from "../runner/screens";
import { WATCHED_PACKAGES } from "../app-versions.mjs";
import type { RecipeContext, RecipeResult } from "./context";
import { runProbe } from "./probe";

/** Settle after a deep link before reading the screen it opened. */
const OPEN_SETTLE_MS = 3_500;

/**
 * A human's order on one target, carried by the engine exactly as the
 * maintainer carries its own gestures — probe first (the account must be in),
 * the target read back on screen before anything is touched, the gesture by
 * selector, the positive verification, the ledger row, the proof.
 *
 * What the order never overrides: the blocks gate (`avatar_platform_blocks`)
 * and the day's budget for likes and follows. Both refuse with an outcome the
 * cockpit can read; neither opens an attention item — the person asked, the
 * person is told.
 *
 * v1 surface: like and follow on TikTok (the verified selectors of 9/09),
 * comment on TikTok and reply on X through the automator's own flows.
 */
export async function runDirectedAction(ctx: RecipeContext): Promise<RecipeResult> {
  const parsed = directedParamsSchema.safeParse(ctx.task.params);
  if (!parsed.success) {
    await ctx.journal.skip("directed_action", `invalid params: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    return { outcome: "invalid_params" };
  }
  const params = parsed.data;
  const platform = ctx.task.platform;
  const target = platform ? appFor(platform) : null;
  const parsedTarget = parseTarget(params.target_url);
  if (!platform || !target || !parsedTarget || parsedTarget.platform !== platform) {
    await ctx.journal.skip("directed_action", "target URL does not belong to the task's platform");
    return { outcome: "unsupported_target" };
  }
  if (params.action !== "comment" && platform !== "tiktok") {
    await ctx.journal.skip("directed_action", `${params.action} on ${platform} is not carried yet — comment only`);
    return { outcome: "unsupported_action_for_platform" };
  }

  const blocked = await ctx.supabase
    .from("avatar_platform_blocks")
    .select("id, reason")
    .eq("avatar_id", ctx.session.avatar.id)
    .eq("platform", platform)
    .is("resolved_at", null)
    .maybeSingle();
  if (blocked.data) {
    await ctx.journal.skip("directed_action", `account blocked on ${platform} (${blocked.data.reason})`);
    return { outcome: "blocked", result: { reason: blocked.data.reason } };
  }

  if (params.action === "like" || params.action === "follow") {
    const budget = await remainingBudget(ctx, "tiktok");
    const left = params.action === "like" ? budget.likesLeft : budget.followsLeft;
    if (left <= 0) {
      await ctx.journal.skip("directed_action", `no ${params.action} left in today's budget`);
      return { outcome: "budget_exhausted", result: { budget } };
    }
  }

  const probe = await runProbe(ctx);
  if (probe.outcome !== "logged_in") {
    await ctx.journal.skip("directed_action", `probe said ${probe.outcome} — no action`);
    return { outcome: `probe_${probe.outcome}`, result: probe.result };
  }

  switch (params.action) {
    case "like":
      return likeTarget(ctx, params, parsedTarget);
    case "follow":
      return followTarget(ctx, params, parsedTarget);
    case "comment":
      return commentTarget(ctx, params, target.app);
  }
}

// ---------------------------------------------------------------------------
// Like
// ---------------------------------------------------------------------------

async function likeTarget(ctx: RecipeContext, params: DirectedParams, target: ParsedTarget): Promise<RecipeResult> {
  const { dev } = ctx.session;
  const opened = await openTarget(ctx, params.target_url, target);
  if (!opened.onTarget) return opened.result;

  const state = likeState(opened.read.tree);
  if (state === "liked") {
    await ctx.journal.skip("like", "already liked");
    return { outcome: "already_done", result: { action: "like", target: params.target_url } };
  }
  const verified = await ctx.journal.step("like", async () => {
    const click = await clickTarget(dev, opened.read.tree, "tiktok.like_button", { locale: dev.locale });
    if (!click.clicked) return { verified: false, detail: "like button not found on screen", proof: true };
    const after = await readTreeAfterGesture(dev, { previousHash: opened.read.tree.hash, expectChange: true, settleMs: 1_200 });
    const ok = likeVerified(opened.read.tree, after.tree);
    return { verified: ok, detail: ok ? "heart flipped" : "heart did not flip", proof: true };
  });
  await pressBack(dev);
  return conclude(ctx, params, "like", verified.verified, "tiktok");
}

// ---------------------------------------------------------------------------
// Follow
// ---------------------------------------------------------------------------

async function followTarget(ctx: RecipeContext, params: DirectedParams, target: ParsedTarget): Promise<RecipeResult> {
  const { dev } = ctx.session;
  const profileUrl = target.profileUrl ?? params.target_url;
  const opened = await openTarget(ctx, profileUrl, { ...target, kind: "profile" });
  if (!opened.onTarget) return opened.result;

  if (followState(opened.read.tree) === "followed") {
    await ctx.journal.skip("follow", "already followed");
    return { outcome: "already_done", result: { action: "follow", target: profileUrl } };
  }
  const verified = await ctx.journal.step("follow", async () => {
    const click = await clickTarget(dev, opened.read.tree, "tiktok.follow_button", { locale: dev.locale });
    if (!click.clicked) return { verified: false, detail: "follow button not found on screen", proof: true };
    const after = await readTreeAfterGesture(dev, { previousHash: opened.read.tree.hash, expectChange: true, settleMs: 1_500 });
    const ok = followVerified(opened.read.tree, after.tree, click.node?.resourceId ?? null);
    return { verified: ok, detail: ok ? "header changed" : "header unchanged", proof: true };
  });
  await pressBack(dev);
  return conclude(ctx, params, "follow", verified.verified, "tiktok", target.handle);
}

// ---------------------------------------------------------------------------
// Comment / reply — the automator's own verified flows
// ---------------------------------------------------------------------------

async function commentTarget(ctx: RecipeContext, params: DirectedParams, platform: "tiktok" | "twitter"): Promise<RecipeResult> {
  const { dev, avatar } = ctx.session;
  const text = params.text ?? "";
  const flow = await ctx.journal.step("comment", async () => {
    const result = platform === "twitter"
      ? await postReply(dev.tunnelHostname, dev.dbId, params.target_url, text)
      : await postTikTokComment(dev.tunnelHostname, dev.dbId, params.target_url, text);
    const key = { accountId: avatar.account_id, avatarId: avatar.id, taskId: ctx.task.id };
    const proofs = {
      source: await storeProof(ctx.supabase, { ...key, index: 90, name: "comment-source" }, result.source),
      proof: await storeProof(ctx.supabase, { ...key, index: 91, name: "comment-proof" }, result.proof),
    };
    return {
      success: result.success,
      error: result.error ?? null,
      proofs,
      detail: result.success ? `posted in ${result.durationMs} ms` : `not posted: ${result.error ?? "unknown"}`,
    };
  });
  const action: AvatarActionKind = platform === "twitter" ? "reply" : "comment";
  const concluded = await conclude(ctx, params, action, flow.success, platform);
  return { ...concluded, result: { ...(concluded.result ?? {}), error: flow.error, proofs: flow.proofs } };
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

type Opened = { onTarget: true; read: TreeRead } | { onTarget: false; result: RecipeResult };

/**
 * Deep-link to the target and make sure the screen is the target: a deep
 * link can fall back to the feed (measured 9/09), and a like on the wrong
 * video is worse than no like.
 */
async function openTarget(ctx: RecipeContext, url: string, target: ParsedTarget): Promise<Opened> {
  const { dev } = ctx.session;
  const opened = await ctx.journal.step("open_target", async () => {
    const before = await readTreeAfterGesture(dev, { previousHash: "", expectChange: false });
    await openDeepLink(dev, url, WATCHED_PACKAGES.tiktok);
    await sleep(OPEN_SETTLE_MS);
    const read = await readTreeAfterGesture(dev, { previousHash: before.tree.hash, expectChange: true, settleMs: 800 });
    const classification = classifyScreen(read.tree, "tiktok");
    const expectedState = target.kind === "profile" ? classification.state === "profile" : MAIN_STATES.includes(classification.state);
    const handleSeen = target.handle ? mentionsHandle(read.tree, target.handle) : true;
    return {
      read,
      onTarget: expectedState && handleSeen,
      screenState: classification.state,
      detail: `${classification.state}; handle ${target.handle ? (handleSeen ? "seen" : "NOT seen") : "unknown"}`,
      proof: !(expectedState && handleSeen),
    };
  });
  if (!opened.onTarget) {
    await pressBack(dev);
    return { onTarget: false, result: { outcome: "target_mismatch", result: { screen_state: opened.screenState, target: url } } };
  }
  return { onTarget: true, read: opened.read };
}

/** The handle shows on a video (author button) and on a profile (header). */
export function mentionsHandle(tree: CompactTree, handle: string): boolean {
  const needle = handle.toLowerCase();
  return findByTextContains(tree.nodes, needle).length > 0 || findByDescContains(tree.nodes, needle).length > 0;
}

async function conclude(
  ctx: RecipeContext,
  params: DirectedParams,
  action: AvatarActionKind,
  verified: boolean,
  platform: "tiktok" | "twitter",
  handle: string | null = null,
): Promise<RecipeResult> {
  if (!verified) {
    return { outcome: "not_verified", result: { action, target: params.target_url, request_id: params.request_id } };
  }
  await recordAvatarAction(ctx.supabase, {
    accountId: ctx.session.avatar.account_id,
    avatarId: ctx.session.avatar.id,
    platform,
    action,
    actor: "operator",
    timezone: ctx.session.device.timezone,
    refKind: "maintenance_task",
    refId: ctx.task.id,
    target: handle ?? params.target_url,
  });
  return { outcome: "done", result: { action, target: params.target_url, request_id: params.request_id, verified: true } };
}
