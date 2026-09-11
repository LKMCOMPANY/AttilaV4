import { clickTarget, openDeepLink, pressBack, tapNode } from "@/lib/engine/actor";
import { readTreeAfterGesture, sleep, type TreeRead } from "@/lib/engine/reader";
import { classifyScreen } from "@/lib/engine/ui/screen-state";
import { likeablePost, xLikeVerified } from "@/lib/engine/ui/x-feed";
import { followVerified, likeState, likeVerified } from "@/lib/engine/verifier";
import type { SocialPlatform } from "@/types";
import { dailyCounts, recordAvatarAction } from "../ledger";
import type { RecipeContext } from "../recipes/context";
import { WATCHED_PACKAGES } from "../app-versions.mjs";
import { markCandidate, nextCandidate } from "./discover";

/**
 * The gestures of a maturing account (phase 3), taken inside the passive
 * session and never outside it: a like on a video or a post the feed happened
 * to show, a follow of a creator the discovery ranked. Each one is verified
 * from the tree (the heart flips, the header changes), written to the ledger,
 * and counted against the day's budget. A gesture that cannot be verified is
 * not counted as done — and is not retried in the same session.
 */

/** X animates the heart for about a second; the tree may be read mid-flight once. */
const X_LIKE_SETTLE_MS = 1_500;
const X_LIKE_READS = 2;
/**
 * The list is still decelerating when the tree is read right after a swipe;
 * a heart tapped at those coordinates lands on the card that slid under it
 * (11/09/2026: posts, videos and one Play Store sheet opened mid-session).
 * A pause and a fresh read before choosing the heart make the tap land.
 */
const X_LIST_REST_MS = 1_200;

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
 * Like what the feed shows — the TikTok video on screen, or the X post a
 * person would pick (not promoted, heart fully visible, nearest the middle).
 * Returns true only when a fresh tree confirms the flip; the ledger row is
 * written then and only then.
 */
export async function likeOnScreen(ctx: RecipeContext, read: TreeRead, platform: SocialPlatform): Promise<boolean> {
  const liked = platform === "tiktok" ? await likeTikTokVideo(ctx, read) : platform === "twitter" ? await likeXPost(ctx, read) : false;
  if (!liked) return false;
  // Several likes happen in one task: the ledger's idempotency key is per
  // (kind, ref, action), so gestures are written without a ref and counted
  // by the task's result instead.
  await recordAvatarAction(ctx.supabase, {
    accountId: ctx.session.avatar.account_id,
    avatarId: ctx.session.avatar.id,
    platform,
    action: "like",
    actor: "maintainer",
    timezone: ctx.session.device.timezone,
    refKind: "maintenance_task",
    refId: null,
    target: null,
  });
  return true;
}

/** The heart of the video on screen, by selector, when it is visibly not lit. */
async function likeTikTokVideo(ctx: RecipeContext, read: TreeRead): Promise<boolean> {
  const { dev } = ctx.session;
  if (likeState(read.tree) !== "not_liked") return false;
  const click = await clickTarget(dev, read.tree, "tiktok.like_button", { locale: dev.locale });
  if (!click.clicked) return false;
  const after = await readTreeAfterGesture(dev, { previousHash: read.tree.hash, expectChange: true, settleMs: 1_200 });
  return likeVerified(read.tree, after.tree);
}

/**
 * The heart of one post of the timeline, tapped at its centre (an
 * accessibility click on these Compose Views opens the post instead), then
 * read back — twice if need be, the first read can catch the animation.
 */
async function likeXPost(ctx: RecipeContext, read: TreeRead): Promise<boolean> {
  const { dev } = ctx.session;
  if (!likeablePost(read.tree)) return false;
  await sleep(X_LIST_REST_MS);
  const rested = await readTreeAfterGesture(dev, { previousHash: read.tree.hash, expectChange: false, settleMs: 300 });
  const post = likeablePost(rested.tree);
  if (!post || !(await tapNode(dev, post.likeNode))) return false;
  let previousHash = rested.tree.hash;
  for (let attempt = 0; attempt < X_LIKE_READS; attempt++) {
    await sleep(X_LIKE_SETTLE_MS);
    const after = await readTreeAfterGesture(dev, { previousHash, expectChange: true, settleMs: 600 });
    if (xLikeVerified(post, after.tree)) return true;
    previousHash = after.tree.hash;
  }
  return false;
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
