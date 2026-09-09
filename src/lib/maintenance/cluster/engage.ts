import { clickTarget, openDeepLink, pressBack } from "@/lib/engine/actor";
import { readTreeAfterGesture, sleep, type TreeRead } from "@/lib/engine/reader";
import { classifyScreen } from "@/lib/engine/ui/screen-state";
import { followVerified, likeState, likeVerified } from "@/lib/engine/verifier";
import { dailyCounts, recordAvatarAction } from "../ledger";
import type { RecipeContext } from "../recipes/context";
import { WATCHED_PACKAGES } from "../app-versions.mjs";
import { markCandidate, nextCandidate } from "./discover";

/**
 * The gestures of a maturing account (phase 3), taken inside the passive
 * session and never outside it: a like on a video the feed happened to show,
 * a follow of a creator the discovery ranked. Each one is verified from the
 * tree (the heart flips, the header changes), written to the ledger, and
 * counted against the day's budget. A gesture that cannot be verified is not
 * counted as done — and is not retried in the same session.
 */

export interface EngagementBudget {
  likesLeft: number;
  followsLeft: number;
}

export async function remainingBudget(ctx: RecipeContext, platform: "tiktok" | "twitter"): Promise<EngagementBudget> {
  const profile = ctx.settings.budgets[await profileOf(ctx)];
  const today = await dailyCounts(ctx.supabase, ctx.session.avatar.id, platform, ctx.session.device.timezone);
  return {
    likesLeft: Math.max(0, profile.likes_per_day - (today.like ?? 0)),
    followsLeft: Math.max(0, profile.follows_per_day - (today.follow ?? 0)),
  };
}

async function profileOf(ctx: RecipeContext): Promise<"new" | "mature"> {
  const { data } = await ctx.supabase.from("avatars").select("maintenance_profile").eq("id", ctx.session.avatar.id).maybeSingle();
  return (data?.maintenance_profile as "new" | "mature" | undefined) ?? "mature";
}

/**
 * Like the video on screen when the heart is visibly not lit. Returns true
 * only when the tree confirms the flip.
 */
export async function likeCurrentVideo(ctx: RecipeContext, read: TreeRead): Promise<boolean> {
  const { dev } = ctx.session;
  if (likeState(read.tree) !== "not_liked") return false;
  const click = await clickTarget(dev, read.tree, "tiktok.like_button", { locale: dev.locale });
  if (!click.clicked) return false;
  const after = await readTreeAfterGesture(dev, { previousHash: read.tree.hash, expectChange: true, settleMs: 1_200 });
  if (!likeVerified(read.tree, after.tree)) return false;
  // Several likes happen in one task: the ledger's idempotency key is per
  // (kind, ref, action), so gestures are written without a ref and counted
  // by the task's result instead.
  await recordAvatarAction(ctx.supabase, {
    accountId: ctx.session.avatar.account_id,
    avatarId: ctx.session.avatar.id,
    platform: "tiktok",
    action: "like",
    actor: "maintainer",
    timezone: ctx.session.device.timezone,
    refKind: "maintenance_task",
    refId: null,
    target: null,
  });
  return true;
}

/**
 * Open the best cluster candidate's profile, follow, verify from the header,
 * come back to the feed. The candidate is marked whatever happens so it is
 * never proposed twice. Returns the handle followed, or null.
 */
export async function followNextCandidate(ctx: RecipeContext): Promise<string | null> {
  const { dev, avatar } = ctx.session;
  const candidate = await nextCandidate(ctx.supabase, avatar.id, "tiktok");
  if (!candidate) return null;

  const before = await readTreeAfterGesture(dev, { previousHash: "", expectChange: false });
  await openDeepLink(dev, `https://www.tiktok.com/@${candidate.handle}`, WATCHED_PACKAGES.tiktok);
  await sleep(3_500);
  const profile = await readTreeAfterGesture(dev, { previousHash: before.tree.hash, expectChange: true, settleMs: 800 });
  if (classifyScreen(profile.tree, "tiktok").state !== "profile") {
    await markCandidate(ctx.supabase, candidate.id, "failed", ctx.task.id);
    await pressBack(dev);
    return null;
  }

  const click = await clickTarget(dev, profile.tree, "tiktok.follow_button", { locale: dev.locale });
  if (!click.clicked) {
    await markCandidate(ctx.supabase, candidate.id, "skipped", ctx.task.id);
    await pressBack(dev);
    return null;
  }
  const after = await readTreeAfterGesture(dev, { previousHash: profile.tree.hash, expectChange: true, settleMs: 1_500 });
  const verified = followVerified(profile.tree, after.tree, click.node?.resourceId ?? null);
  await markCandidate(ctx.supabase, candidate.id, verified ? "followed" : "failed", ctx.task.id);
  if (verified) {
    await recordAvatarAction(ctx.supabase, {
      accountId: avatar.account_id,
      avatarId: avatar.id,
      platform: "tiktok",
      action: "follow",
      actor: "maintainer",
      timezone: ctx.session.device.timezone,
      refKind: "maintenance_task",
      refId: null,
      target: candidate.handle,
    });
  }
  await pressBack(dev);
  await sleep(1_200);
  return verified ? candidate.handle : null;
}
