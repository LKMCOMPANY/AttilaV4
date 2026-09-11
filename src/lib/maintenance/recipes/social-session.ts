import { scrollFeed } from "@/lib/engine/actor";
import { readTreeAfterGesture, sleep, type TreeRead } from "@/lib/engine/reader";
import { classifyScreen, SAFE_REACTION, type Classification } from "@/lib/engine/ui/screen-state";
import { discoverCandidates } from "../cluster/discover";
import { followNextCandidate, likeOnScreen, remainingBudget, type EngagementBudget } from "../cluster/engage";
import { recordAvatarAction } from "../ledger";
import { engagementGranted } from "../modes";
import { appFor, MAIN_STATES, settleApp, statusFromScreen } from "../runner/screens";
import { jitter, type RecipeContext, type RecipeResult } from "./context";
import { escalate, runProbe, writeState } from "./probe";

/** Seconds spent on one video/post before moving on: a human's range. */
const DWELL_MIN_S = 4;
const DWELL_MAX_S = 25;
/** One pause in ten is a long one (reading comments, looking away). */
const LONG_PAUSE_PROBABILITY = 0.1;
const LONG_PAUSE_MIN_S = 30;
const LONG_PAUSE_MAX_S = 60;
/** Journal cadence: a step every N scrolls, a proof every M steps. */
const SCROLLS_PER_STEP = 6;
const PROOF_EVERY_STEPS = 3;
/**
 * Unfamiliar screens in a row before the session gives up. A person who meets
 * one odd card in the feed scrolls past it; two in a row is not the feed.
 */
const MAX_UNKNOWN_STREAK = 2;

/**
 * The session: open the app, let the probe say the account is in, then read
 * the feed like a person for a few minutes — scroll, dwell, clear a dialog if
 * one comes up, stop at once on any state a human must see.
 *
 * Passive by default (phase 1). With `params.allow_engagement` (the planner
 * sets it once the account is mature; an operator sets it on a session they
 * order) and the grant of `modes.ts` (`autonomous`, or a human's order), the
 * phase 3 gestures ride the same loop: a like now and then on a video or a
 * post the feed shows, one follow of a discovered cluster creator early in the
 * session (TikTok) — each verified from the tree and counted against the
 * day's budget. The discovery itself (TikHub search on the armies' keywords)
 * runs first.
 *
 * Every session is one `session` row in the ledger and moves the twin's
 * `last_session_at`; the planner's ramp-up reads that.
 */
export async function runSocialSession(ctx: RecipeContext, random: () => number = Math.random): Promise<RecipeResult> {
  const platform = ctx.task.platform;
  const target = platform ? appFor(platform) : null;
  if (!platform || !target) {
    await ctx.journal.skip("social_session", "no platform or no recipe for it");
    return { outcome: "unsupported_platform" };
  }

  const probe = await runProbe(ctx);
  if (probe.outcome !== "logged_in") {
    await ctx.journal.skip("watch_feed", `probe said ${probe.outcome} — no session`);
    return { outcome: `probe_${probe.outcome}`, result: probe.result };
  }

  const minutes = Number(ctx.task.params.minutes ?? 5);
  const deadline = Date.now() + Math.max(1, minutes) * 60_000;
  const { dev } = ctx.session;
  const startedAt = new Date();
  let scrolls = 0;
  let steps = 0;
  /** The screen that ended the session early, if any. */
  let stopped: Classification | null = null;
  let dialogs = 0;
  let likes = 0;
  let follows = 0;

  const engaging = ctx.task.params.allow_engagement === true && engagementGranted(ctx.settings.mode, ctx.task.created_by);
  let budget: EngagementBudget = { likesLeft: 0, followsLeft: 0 };
  if (engaging) {
    budget = await ctx.journal.step("discover_cluster", async () => {
      const report = await discoverCandidates(ctx.supabase, ctx.session.avatar, platform, ctx.settings.discoverySearchesPerDay);
      const left = await remainingBudget(ctx, platform === "tiktok" ? "tiktok" : "twitter");
      return { ...left, detail: `${report.searched} search(es), ${report.discovered} new candidate(s); budget ${left.likesLeft} like(s), ${left.followsLeft} follow(s)` };
    });
    if (budget.followsLeft > 0 && platform === "tiktok") {
      const followed = await ctx.journal.step("follow_candidate", async () => {
        const handle = await followNextCandidate(ctx);
        return { handle, detail: handle ? `followed @${handle}` : "no candidate followed", proof: Boolean(handle) };
      });
      if (followed.handle) {
        follows++;
        budget.followsLeft--;
      }
    }
  }
  // Freshness telemetry for the pilot: how often the tree needed a kick, and
  // how often it stayed stale anyway (the 1.1.3 line, measured 9/09).
  let refreshedReads = 0;
  let staleReads = 0;
  let unknownStreak = 0;

  let read: TreeRead = await readTreeAfterGesture(dev, { previousHash: "", expectChange: false });
  while (Date.now() < deadline && !stopped) {
    const batch = await ctx.journal.step("watch_feed", async () => {
      const seen: string[] = [];
      const halt = (at: Classification) => ({ seen, halt: at, screenState: at.state, detail: `stopped on ${at.evidence}`, proof: true });
      for (let i = 0; i < SCROLLS_PER_STEP && Date.now() < deadline; i++) {
        const long = random() < LONG_PAUSE_PROBABILITY;
        const dwellS = long ? jitter(random, LONG_PAUSE_MIN_S, LONG_PAUSE_MAX_S) : jitter(random, DWELL_MIN_S, DWELL_MAX_S);
        await sleep(Math.round(dwellS * 1000));
        const before = read.tree.hash;
        await scrollFeed(dev, read.tree, { random });
        scrolls++;
        const fresh = await readTreeAfterGesture(dev, { previousHash: before, expectChange: true, settleMs: 900 });
        if (fresh.refreshed) refreshedReads++;
        if (fresh.stale) staleReads++;
        read = fresh;
        const classification = classifyScreen(read.tree, target.app);
        seen.push(classification.state);
        if (MAIN_STATES.includes(classification.state)) {
          unknownStreak = 0;
          if (engaging && budget.likesLeft > 0 && random() < ctx.settings.likeProbability) {
            if (await likeOnScreen(ctx, read, platform)) {
              likes++;
              budget.likesLeft--;
            }
          }
          continue;
        }
        // A security state stops the session on the spot (11/09/2026: X 11.96
        // raised its version wall on DE3 after the first scroll).
        if (SAFE_REACTION[classification.state] === "stop") return halt(classification);
        // Anything else in the middle of the feed — a sheet (the TikTok Shop
        // consent, same day), a loading screen, an unfamiliar tree — goes
        // through the same settle as a launch: cleared the safe way, waited
        // out, or confirmed before it is believed. The feed back means go on.
        const settled = await settleApp(dev, target.app);
        dialogs += settled.dismissed.length;
        read = settled.read;
        if (MAIN_STATES.includes(settled.classification.state)) {
          unknownStreak = 0;
          continue;
        }
        if (SAFE_REACTION[settled.classification.state] === "stop") return halt(settled.classification);
        // Confirmed unfamiliar, not a security state: one odd card in the feed
        // is scrolled past like a person would; the next one ends the session.
        if (++unknownStreak >= MAX_UNKNOWN_STREAK) return halt(settled.classification);
      }
      steps++;
      return {
        seen,
        halt: null,
        screenState: seen[seen.length - 1],
        detail: `${scrolls} scrolls so far, ${dialogs} dialog(s) cleared`,
        proof: steps % PROOF_EVERY_STEPS === 0,
      };
    });
    stopped = batch.halt;
    if (batch.seen.length === 0) break;
  }

  const endedAt = new Date();
  await recordAvatarAction(ctx.supabase, {
    accountId: ctx.session.avatar.account_id,
    avatarId: ctx.session.avatar.id,
    platform,
    action: "session",
    actor: "maintainer",
    timezone: ctx.session.device.timezone,
    refKind: "maintenance_task",
    refId: ctx.task.id,
    occurredAt: startedAt,
  });
  // The screen that stopped the session is worth exactly what a launch screen
  // is worth: the twin records it and the same escalation opens the block and
  // the item (a wall mid-feed is still a wall).
  const status = stopped ? statusFromScreen(stopped.state) : "logged_in";
  await writeState(ctx, platform, status, stopped, { lastSessionAt: endedAt });
  if (stopped) {
    await escalate(ctx, platform, status, stopped);
    return { outcome: `stopped_on_${stopped.state}`, result: sessionResult() };
  }
  return { outcome: "session_done", result: sessionResult() };

  function sessionResult(): Record<string, unknown> {
    return {
      scrolls,
      dialogs,
      minutes,
      duration_ms: endedAt.getTime() - startedAt.getTime(),
      refreshed_reads: refreshedReads,
      stale_reads: staleReads,
      agent_line: dev.agentLine ?? null,
      likes,
      follows,
      engagement: engaging,
    };
  }
}
