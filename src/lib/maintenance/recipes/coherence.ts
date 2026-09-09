import { fetchProxyConfig, fetchTimezoneLocale } from "@/lib/box-api";
import { openAttention, resolveAttentionForTarget } from "../attention";
import { localeCoherence, timezoneCoherence } from "../geo";
import type { RecipeContext, RecipeResult } from "./context";

/**
 * Does the device tell the same story as the persona? Timezone and locale
 * read from the running container against `avatars.country_code` /
 * `language_code`; the proxy against the rule that every maintained device
 * routes through one. Exit-IP geolocation is phase 2 (it needs an echo
 * through the container). Each incoherence is one attention item; a fixed one
 * is resolved on the next pass.
 */
export async function runCoherence(ctx: RecipeContext): Promise<RecipeResult> {
  const { dev, device, avatar } = ctx.session;
  const deviceTarget = { accountId: avatar.account_id, scope: "device" as const, deviceId: device.id };

  const facts = await ctx.journal.step("read_device_facts", async () => {
    const [tzl, proxy] = await Promise.all([
      fetchTimezoneLocale(dev.tunnelHostname, dev.dbId).catch(() => null),
      fetchProxyConfig(dev.tunnelHostname, dev.dbId).catch(() => null),
    ]);
    // Never journal the proxy object: it carries the password in clear.
    return {
      timezone: tzl?.timezone ?? device.timezone ?? null,
      locale: tzl?.locale ?? device.locale ?? null,
      proxyEnabled: proxy ? proxy.enabled : device.proxy_enabled,
      detail: `tz=${tzl?.timezone ?? "?"} locale=${tzl?.locale ?? "?"} proxy=${proxy ? (proxy.enabled ? "on" : "off") : "unknown"}`,
    };
  });

  if (facts.timezone || facts.locale) {
    await ctx.supabase
      .from("devices")
      .update({
        ...(facts.timezone ? { timezone: facts.timezone } : {}),
        ...(facts.locale ? { locale: facts.locale } : {}),
        last_seen: new Date().toISOString(),
      })
      .eq("id", device.id);
  }

  const tz = timezoneCoherence(avatar.country_code, facts.timezone);
  const locale = localeCoherence(avatar.country_code, facts.locale);
  const findings: string[] = [];

  if (tz === "incoherent") {
    findings.push("timezone");
    await openAttention(ctx.supabase, {
      ...deviceTarget,
      reason: "timezone_incoherent",
      severity: "warning",
      title: `Fuseau ${facts.timezone} pour un persona ${avatar.country_code}`,
      detail: `${avatar.first_name} ${avatar.last_name} est déclaré en ${avatar.country_code} ; le device vit en ${facts.timezone}.`,
      evidence: { observed: facts.timezone ?? "", expected: avatar.country_code },
      source: "maintainer",
    });
  } else if (tz === "coherent") {
    await resolveAttentionForTarget(ctx.supabase, deviceTarget, "reprobe", ["timezone_incoherent"]);
  }

  if (locale === "incoherent") {
    findings.push("locale");
    await openAttention(ctx.supabase, {
      ...deviceTarget,
      reason: "persona_device_mismatch",
      severity: "warning",
      title: `Langue du device ${facts.locale} pour un persona ${avatar.language_code.toUpperCase()}`,
      detail: "La langue de l'appareil ne correspond pas à celle du persona ; les libellés de l'interface et le comportement attendu divergent.",
      evidence: { observed: facts.locale ?? "", expected: avatar.language_code },
      source: "maintainer",
    });
  } else if (locale === "coherent") {
    await resolveAttentionForTarget(ctx.supabase, deviceTarget, "reprobe", ["persona_device_mismatch"]);
  }

  if (facts.proxyEnabled === false) {
    findings.push("proxy");
    await openAttention(ctx.supabase, {
      ...deviceTarget,
      reason: "proxy_incoherent",
      severity: "warning",
      title: "Aucun proxy appliqué sur le device",
      detail: "Le device sort avec l'adresse de la box. Appliquer le proxy du persona avant toute session.",
      source: "maintainer",
    });
  } else if (facts.proxyEnabled === true) {
    await resolveAttentionForTarget(ctx.supabase, deviceTarget, "reprobe", ["proxy_incoherent"]);
  }

  return {
    outcome: findings.length === 0 ? "coherent" : "incoherent",
    result: { timezone: tz, locale, proxy_enabled: facts.proxyEnabled, findings },
  };
}
