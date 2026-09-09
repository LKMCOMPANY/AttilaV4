import { fetchPackageInfo, type V2PackageInfo } from "@/lib/box-api";
import { openAttention, resolveAttentionForTarget } from "../attention";
import { WATCHED_PACKAGES, twitterWallStatus, versionNameFor } from "../app-versions.mjs";
import type { RecipeContext, RecipeResult } from "./context";

const WATCHED = [WATCHED_PACKAGES.tiktok, WATCHED_PACKAGES.twitter, WATCHED_PACKAGES.adbkeyboard] as const;

/**
 * Which build of TikTok, X and ADBKeyboard the device carries, read live from
 * the v2 agent and persisted to `device_app_versions` (source `online_v2`).
 * Two facts become attention items: an X build behind the "out of date" wall
 * (nothing posts through it), and a missing ADBKeyboard (nothing types).
 */
export async function runAppCheck(ctx: RecipeContext): Promise<RecipeResult> {
  const { dev, device, avatar } = ctx.session;
  const packages = await ctx.journal.step("read_packages", async () => {
    const found = await fetchPackageInfo(dev.tunnelHostname, dev.dbId, WATCHED);
    return { found, detail: found.map((p) => `${p.package_name}=${p.version_name ?? p.version_code ?? "?"}`).join(" ") };
  });

  const byPackage = new Map<string, V2PackageInfo>(packages.found.map((p) => [p.package_name, p]));
  const now = new Date().toISOString();
  const rows = WATCHED.filter((pkg) => byPackage.has(pkg)).map((pkg) => {
    const info = byPackage.get(pkg)!;
    const code = info.version_code ?? null;
    return {
      device_id: device.id,
      package: pkg,
      version_name: info.version_name ?? versionNameFor(pkg, code),
      version_code: code,
      checked_at: now,
      source: "online_v2",
    };
  });
  if (rows.length > 0) {
    const { error } = await ctx.supabase.from("device_app_versions").upsert(rows, { onConflict: "device_id,package" });
    if (error) console.error(`[Maintenance] device_app_versions upsert failed: ${error.message}`);
  }

  const deviceTarget = { accountId: avatar.account_id, scope: "device" as const, deviceId: device.id };
  const x = byPackage.get(WATCHED_PACKAGES.twitter);
  const wall = twitterWallStatus(x?.version_code ?? null);
  if (wall === "walled_or_at_risk") {
    await openAttention(ctx.supabase, {
      ...deviceTarget,
      reason: "app_outdated",
      severity: "warning",
      title: `X ${x?.version_name ?? versionNameFor(WATCHED_PACKAGES.twitter, x?.version_code) ?? ""} est derrière le mur de version`,
      detail: "Les builds ≤ 11.97 affichent « This app is out of date » ; 12.20+ s'ouvrent. Installer un build récent.",
      evidence: { observed: String(x?.version_code ?? ""), expected: "≥ 312200000" },
      source: "maintainer",
    });
  } else if (wall === "ok") {
    await resolveAttentionForTarget(ctx.supabase, deviceTarget, "reprobe", ["app_outdated"]);
  }

  if (!byPackage.has(WATCHED_PACKAGES.adbkeyboard)) {
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

  return {
    outcome: wall === "walled_or_at_risk" ? "x_walled" : "ok",
    result: { packages: rows.map((r) => ({ package: r.package, version_name: r.version_name, version_code: r.version_code })), x_wall: wall },
  };
}
