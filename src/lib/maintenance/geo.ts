/**
 * Where a persona lives → which device timezones and locale languages are
 * coherent with it. Deliberately small: the countries the fleet uses today.
 * An unknown country is "no opinion", never an incoherence.
 */

const TIMEZONES: Record<string, readonly string[]> = {
  FR: ["Europe/Paris"],
  BE: ["Europe/Brussels"],
  CH: ["Europe/Zurich"],
  DE: ["Europe/Berlin"],
  ES: ["Europe/Madrid"],
  IT: ["Europe/Rome"],
  PT: ["Europe/Lisbon"],
  NL: ["Europe/Amsterdam"],
  GB: ["Europe/London"],
  IE: ["Europe/Dublin"],
  MA: ["Africa/Casablanca"],
  DZ: ["Africa/Algiers"],
  TN: ["Africa/Tunis"],
  SN: ["Africa/Dakar"],
  CI: ["Africa/Abidjan"],
  CM: ["Africa/Douala"],
  EG: ["Africa/Cairo"],
  AE: ["Asia/Dubai"],
  SA: ["Asia/Riyadh"],
  QA: ["Asia/Qatar"],
  TR: ["Europe/Istanbul"],
  US: [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "America/Detroit",
  ],
  CA: ["America/Toronto", "America/Vancouver", "America/Montreal", "America/Edmonton", "America/Winnipeg", "America/Halifax"],
  BR: ["America/Sao_Paulo", "America/Bahia", "America/Fortaleza", "America/Manaus"],
  MX: ["America/Mexico_City", "America/Cancun", "America/Tijuana", "America/Monterrey"],
  AR: ["America/Argentina/Buenos_Aires"],
  CO: ["America/Bogota"],
  IN: ["Asia/Kolkata"],
  ID: ["Asia/Jakarta"],
  PH: ["Asia/Manila"],
  JP: ["Asia/Tokyo"],
  AU: ["Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane", "Australia/Perth"],
};

const LANGUAGES: Record<string, readonly string[]> = {
  FR: ["fr"],
  BE: ["fr", "nl"],
  CH: ["fr", "de", "it"],
  DE: ["de"],
  ES: ["es"],
  IT: ["it"],
  PT: ["pt"],
  NL: ["nl"],
  GB: ["en"],
  IE: ["en"],
  MA: ["ar", "fr"],
  DZ: ["ar", "fr"],
  TN: ["ar", "fr"],
  SN: ["fr"],
  CI: ["fr"],
  CM: ["fr", "en"],
  EG: ["ar"],
  AE: ["ar", "en"],
  SA: ["ar"],
  QA: ["ar", "en"],
  TR: ["tr"],
  US: ["en", "es"],
  CA: ["en", "fr"],
  BR: ["pt"],
  MX: ["es"],
  AR: ["es"],
  CO: ["es"],
  IN: ["en", "hi"],
  ID: ["id"],
  PH: ["en", "fil"],
  JP: ["ja"],
  AU: ["en"],
};

export type CoherenceVerdict = "coherent" | "incoherent" | "unknown";

/** Is `timezone` a plausible home zone for a persona in `countryCode`? */
export function timezoneCoherence(countryCode: string | null | undefined, timezone: string | null | undefined): CoherenceVerdict {
  const zones = countryCode ? TIMEZONES[countryCode.toUpperCase()] : undefined;
  if (!zones || !timezone) return "unknown";
  return zones.includes(timezone) ? "coherent" : "incoherent";
}

/** Does the device locale (`fr-FR`, `en_US`) speak a language spoken in the persona's country? */
export function localeCoherence(countryCode: string | null | undefined, locale: string | null | undefined): CoherenceVerdict {
  const languages = countryCode ? LANGUAGES[countryCode.toUpperCase()] : undefined;
  if (!languages || !locale) return "unknown";
  const language = locale.toLowerCase().split(/[-_]/)[0];
  return languages.includes(language) ? "coherent" : "incoherent";
}

export const KNOWN_COUNTRIES: readonly string[] = Object.keys(TIMEZONES);
