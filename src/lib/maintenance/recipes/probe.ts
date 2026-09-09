import { fetchPackageInfo } from "@/lib/box-api";
import { closeBlock, openBlock } from "@/lib/account-state/blocks";
import { sleep } from "@/lib/engine/reader";
import type { Classification } from "@/lib/engine/ui/screen-state";
import type { OnDeviceStatus, SocialPlatform } from "@/types";
import { openAttention, resolveAttentionForTarget } from "../attention";
import { appFor, openApp, settleApp, statusFromScreen, MAIN_STATES } from "../runner/screens";
import type { RecipeContext, RecipeResult } from "./context";

const LAUNCH_SETTLE_MS = 2_500;

/** Reasons a healthy probe closes on the account. */
const ACCOUNT_REASONS_CLEARED_BY_LOGIN = ["needs_login", "captcha", "dialog_unknown"] as const;

/**
 * The daily question: is the account still there on its device, and what
 * does the screen say? Launches the app cold, clears the safe dialogs, reads
 * the settled screen, writes the twin (`avatar_platform_state`) and escalates
 * what only a human can fix — with the screen as proof.
 */
export async function runProbe(ctx: RecipeContext): Promise<RecipeResult> {
  const platform = ctx.task.platform;
  const target = platform ? appFor(platform) : null;
  if (!platform || !target) {
    await ctx.journal.skip("probe", "no platform or no recipe for it");
    return { outcome: "unsupported_platform" };
  }

  const { dev } = ctx.session;
  const launcher = await ctx.journal.step("resolve_app", async () => {
    const info = await fetchPackageInfo(dev.tunnelHostname, dev.dbId, [target.packageName]).catch(() => []);
    const app = info.find((p) => p.package_name === target.packageName);
    return { installed: Boolean(app), launcherActivity: app?.launcher_activity ?? null, detail: app ? `${app.version_name ?? app.version_code ?? "?"}` : "not installed" };
  });
  if (!launcher.installed) {
    await writeState(ctx, platform, "app_missing", null);
    await openAttention(ctx.supabase, {
      accountId: ctx.session.avatar.account_id,
      scope: "device",
      deviceId: ctx.session.device.id,
      reason: "app_missing",
      severity: "warning",
      title: `${target.app === "tiktok" ? "TikTok" : "X"} n'est pas installé sur ce device`,
      source: "maintainer",
    });
    return { outcome: "app_missing" };
  }

  await ctx.journal.step("launch", async () => {
    await openApp(dev, target.packageName, launcher.launcherActivity);
    await sleep(LAUNCH_SETTLE_MS);
    return {};
  });

  const settled = await ctx.journal.step("settle", async () => {
    const result = await settleApp(dev, target.app);
    return {
      ...result,
      screenState: result.classification.state,
      detail: result.dismissed.length ? `dismissed: ${result.dismissed.join(", ")}` : result.classification.evidence,
      proof: !MAIN_STATES.includes(result.classification.state),
    };
  });

  const status = statusFromScreen(settled.classification.state);
  await writeState(ctx, platform, status, settled.classification);
  await escalate(ctx, platform, status, settled.classification);
  return {
    outcome: status,
    result: { screen_state: settled.classification.state, evidence: settled.classification.evidence, dismissed: settled.dismissed },
  };
}

/** Rewrite the twin row for this account: what the device last showed, and when. */
export async function writeState(
  ctx: RecipeContext,
  platform: SocialPlatform,
  status: OnDeviceStatus,
  classification: Classification | null,
  extra: { lastSessionAt?: Date } = {},
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await ctx.supabase.from("avatar_platform_state").upsert(
    {
      avatar_id: ctx.session.avatar.id,
      platform,
      on_device_status: status,
      last_screen_state: classification?.state ?? null,
      probed_at: now,
      ...(status === "logged_in" ? { last_login_at: now } : {}),
      ...(extra.lastSessionAt ? { last_session_at: extra.lastSessionAt.toISOString() } : {}),
    },
    { onConflict: "avatar_id,platform" },
  );
  if (error) console.error(`[Maintenance] avatar_platform_state upsert failed: ${error.message}`);
}

/**
 * Turn the on-device status into the two records that matter: the Automator
 * gate (`avatar_platform_blocks`) and the human queue (`attention_items`), or
 * clear both when the account is back.
 */
async function escalate(ctx: RecipeContext, platform: SocialPlatform, status: OnDeviceStatus, classification: Classification) {
  const { supabase, session } = ctx;
  const accountId = session.avatar.account_id;
  const avatarId = session.avatar.id;
  const proofPath = ctx.journal.lastProofPath();
  const evidence = { screen_state: classification.state, observed: classification.evidence, proof_path: proofPath };
  const accountTarget = { accountId, scope: "avatar_platform" as const, avatarId, platform };

  switch (status) {
    case "logged_in": {
      await resolveAttentionForTarget(supabase, accountTarget, "reprobe", ACCOUNT_REASONS_CLEARED_BY_LOGIN);
      await closeBlock(supabase, { avatarId, platform, resolvedBy: "maintainer" });
      if (platform === "twitter") {
        await resolveAttentionForTarget(
          supabase,
          { accountId, scope: "device", deviceId: session.device.id },
          "reprobe",
          ["app_outdated"],
        );
      }
      return;
    }
    case "logged_out": {
      const blockId = await openBlock(supabase, { avatarId, platform, reason: "logged_out", source: "on_device", detail: classification.evidence });
      await openAttention(supabase, {
        ...accountTarget,
        reason: "needs_login",
        severity: "critical",
        title: "Session expirée — reconnexion nécessaire",
        detail: `Le device a montré l'écran de connexion (${classification.evidence}).`,
        evidence,
        source: "maintainer",
        blockId,
      });
      return;
    }
    case "challenge": {
      const blockId = await openBlock(supabase, { avatarId, platform, reason: "captcha", source: "on_device", detail: classification.evidence });
      await openAttention(supabase, {
        ...accountTarget,
        reason: "captcha",
        severity: "critical",
        title: "Vérification demandée par la plateforme",
        detail: `Le device a montré un contrôle de sécurité (${classification.evidence}).`,
        evidence,
        source: "maintainer",
        blockId,
      });
      return;
    }
    case "app_outdated": {
      await openAttention(supabase, {
        accountId,
        scope: "device",
        deviceId: session.device.id,
        reason: "app_outdated",
        severity: "warning",
        title: `${platform === "twitter" ? "X" : "TikTok"} refuse de s'ouvrir : version obsolète`,
        detail: "L'écran « This app is out of date » bloque l'application. Installer un build récent sur ce device.",
        evidence,
        source: "maintainer",
      });
      return;
    }
    case "unknown": {
      await openAttention(supabase, {
        ...accountTarget,
        reason: "dialog_unknown",
        severity: "warning",
        title: "Écran non reconnu au lancement",
        detail: `Le classifieur n'a pas reconnu l'écran (${classification.evidence}). Regarder la preuve.`,
        evidence,
        source: "maintainer",
      });
      return;
    }
    default:
      return;
  }
}
