import { scrollFeed } from "@/lib/engine/actor";
import { readTreeAfterGesture, sleep, type TreeRead } from "@/lib/engine/reader";
import { classifyScreen, SAFE_REACTION } from "@/lib/engine/ui/screen-state";
import { recordAvatarAction } from "../ledger";
import { appFor, MAIN_STATES, settleApp } from "../runner/screens";
import { jitter, type RecipeContext, type RecipeResult } from "./context";
import { runProbe, writeState } from "./probe";

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
 * The passive session (phase 1): open the app, let the probe say the account
 * is in, then read the feed like a person for a few minutes — scroll, dwell,
 * clear a dialog if one comes up, stop at once on any state a human must
 * see. No like, no follow, no comment: `params.allow_engagement` is recorded
 * for phase 3, which adds the cluster-driven gestures on the same loop.
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
  let stopped: string | null = null;
  let dialogs = 0;

  let read: TreeRead = await readTreeAfterGesture(dev, { previousHash: "", expectChange: false });
  while (Date.now() < deadline && !stopped) {
    const batch = await ctx.journal.step("watch_feed", async () => {
      const seen: string[] = [];
      for (let i = 0; i < SCROLLS_PER_STEP && Date.now() < deadline; i++) {
        const long = random() < LONG_PAUSE_PROBABILITY;
        const dwellS = long ? jitter(random, LONG_PAUSE_MIN_S, LONG_PAUSE_MAX_S) : jitter(random, DWELL_MIN_S, DWELL_MAX_S);
        await sleep(Math.round(dwellS * 1000));
        const before = read.tree.hash;
        await scrollFeed(dev, read.tree, { random });
        scrolls++;
        read = await readTreeAfterGesture(dev, { previousHash: before, expectChange: true, settleMs: 900 });
        const classification = classifyScreen(read.tree, target.app);
        seen.push(classification.state);
        if (MAIN_STATES.includes(classification.state)) continue;
        const reaction = SAFE_REACTION[classification.state];
        if (reaction === "stop" || reaction === "vision") {
          stopped = classification.state;
          return { seen, screenState: classification.state, detail: `stopped on ${classification.evidence}`, proof: true };
        }
        // A dialog in the middle of the feed: clear it the safe way and go on.
        const settled = await settleApp(dev, target.app);
        dialogs += settled.dismissed.length;
        read = settled.read;
        if (!MAIN_STATES.includes(settled.classification.state)) {
          stopped = settled.classification.state;
          return { seen, screenState: settled.classification.state, detail: `stopped on ${settled.classification.evidence}`, proof: true };
        }
      }
      steps++;
      return {
        seen,
        screenState: seen[seen.length - 1],
        detail: `${scrolls} scrolls so far, ${dialogs} dialog(s) cleared`,
        proof: steps % PROOF_EVERY_STEPS === 0,
      };
    });
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
  await writeState(ctx, platform, stopped ? "unknown" : "logged_in", null, { lastSessionAt: endedAt });

  if (stopped) {
    // The probe's escalation already covers a stop at launch; a stop mid-feed
    // is rarer and goes to the queue with the last proof through the runner's
    // outcome (`stopped_on_*`), which the operator sees in the task journal.
    return { outcome: `stopped_on_${stopped}`, result: { scrolls, dialogs, minutes, duration_ms: endedAt.getTime() - startedAt.getTime() } };
  }
  return { outcome: "session_done", result: { scrolls, dialogs, minutes, duration_ms: endedAt.getTime() - startedAt.getTime() } };
}
