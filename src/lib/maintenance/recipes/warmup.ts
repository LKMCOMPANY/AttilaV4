import { wakeDevice } from "@/lib/automation/adb-helpers";
import { pressHome } from "@/lib/engine/actor";
import { readTree, sleep } from "@/lib/engine/reader";
import { runAppCheck } from "./app-check";
import { runCoherence } from "./coherence";
import type { RecipeContext, RecipeResult } from "./context";
import { runProbe } from "./probe";

/**
 * A new device's first pass, or a stray dialog sweep: wake the screen, go
 * home, then the three checks in one sitting — apps, coherence, and the
 * account probe. The outcome is the probe's, since that is what decides
 * whether sessions can start.
 */
export async function runWarmup(ctx: RecipeContext): Promise<RecipeResult> {
  const { dev } = ctx.session;
  await ctx.journal.step("wake_home", async () => {
    await wakeDevice(dev.tunnelHostname, dev.dbId);
    await pressHome(dev);
    await sleep(1_200);
    const read = await readTree(dev);
    return { detail: `${read.tree.nodes.length} nodes on the home screen (${read.source})` };
  });

  const apps = await runAppCheck(ctx);
  const coherence = await runCoherence(ctx);
  const probe = await runProbe(ctx);
  return {
    outcome: probe.outcome,
    result: { app_check: apps.result, coherence: coherence.result, probe: probe.result },
  };
}

/**
 * Clear whatever dialogs sit over the app right now, and report the settled
 * screen. Same steps as the probe without the day's bookkeeping — an
 * operator-requested sweep.
 */
export async function runDismissDialogs(ctx: RecipeContext): Promise<RecipeResult> {
  const probe = await runProbe(ctx);
  return { outcome: probe.outcome, result: probe.result };
}
