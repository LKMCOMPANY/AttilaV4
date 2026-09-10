import { openAttention, resolveAttentionForTarget } from "../attention";
import { WATCHED_PACKAGES, twitterWallStatus, versionNameFor } from "../app-versions.mjs";
import { readPackages } from "../runner/packages";
import type { RecipeContext, RecipeResult } from "./context";

const WATCHED = [WATCHED_PACKAGES.tiktok, WATCHED_PACKAGES.twitter, WATCHED_PACKAGES.adbkeyboard] as const;

/**
 * Which build of TikTok, X and ADBKeyboard the device carries, read live
 * (v2 agent, or the guest shell when the host route is down) and persisted to
 * `device_app_versions`. Two facts become attention items: a missing
 * ADBKeyboard (nothing types), and a watched app that is not installed.
 *
 * The X version wall is NOT judged from the build number here: an X 11.86
 * opened its feed on box-2 on 10 September while the census called it
 * walled. The probe, which sees the screen, opens and resolves
 * `app_outdated`; this recipe only records the version and the "at risk"
 * flag in its result.
 */
export async function runAppCheck(ctx: RecipeContext): Promise<RecipeResult> {
  const { dev, device, avatar } = ctx.session;
  const packages = await ctx.journal.step("read_packages", async () => {
    const found = await readPackages(dev, WATCHED);
    return {
      found,
      detail: found.map((p) => `${p.packageName}=${p.installed ? p.versionName ?? p.versionCode ?? "?" : "absent"} (${p.source})`).join(" "),
    };
  });

  const now = new Date().toISOString();
  const installed = packages.found.filter((p) => p.installed);
  const rows = installed.map((p) => ({
    device_id: device.id,
    package: p.packageName,
    version_name: p.versionName ?? versionNameFor(p.packageName, p.versionCode),
    version_code: p.versionCode,
    checked_at: now,
    source: "online_v2",
  }));
  if (rows.length > 0) {
    const { error } = await ctx.supabase.from("device_app_versions").upsert(rows, { onConflict: "device_id,package" });
    if (error) console.error(`[Maintenance] device_app_versions upsert failed: ${error.message}`);
  }

  const deviceTarget = { accountId: avatar.account_id, scope: "device" as const, deviceId: device.id };
  const isInstalled = (pkg: string) => installed.some((p) => p.packageName === pkg);

  if (!isInstalled(WATCHED_PACKAGES.adbkeyboard)) {
    await openAttention(ctx.supabase, {
      ...deviceTarget,
      reason: "adbkeyboard_missing",
      severity: "critical",
      title: "ADBKeyboard absent — aucune saisie possible",
      detail: "L'unique méthode de saisie des flux n'est pas installée sur ce device.",
      source: "maintainer",
    });
  } else {
    await resolveAttentionForTarget(ctx.supabase, deviceTarget, "reprobe", ["adbkeyboard_missing"]);
  }

  const x = installed.find((p) => p.packageName === WATCHED_PACKAGES.twitter);
  const wall = twitterWallStatus(x?.versionCode ?? null);
  return {
    outcome: wall === "walled_or_at_risk" ? "x_at_risk" : "ok",
    result: {
      packages: rows.map((r) => ({ package: r.package, version_name: r.version_name, version_code: r.version_code })),
      x_wall: wall,
      source: packages.found[0]?.source ?? "unknown",
    },
  };
}
