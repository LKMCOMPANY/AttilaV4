export interface Country {
  code: string;
  name: string;
  language: string;
  locale: string;
  region: CountryRegion;
}

export type CountryRegion =
  | "europe"
  | "north_america"
  | "south_america"
  | "central_america"
  | "caribbean"
  | "africa"
  | "middle_east"
  | "asia"
  | "oceania";

export const COUNTRIES: Country[] = [
  // EUROPE
  { code: "AL", name: "Albania", language: "sq", locale: "sq-AL", region: "europe" },
  { code: "AD", name: "Andorra", language: "ca", locale: "ca-AD", region: "europe" },
  { code: "AT", name: "Austria", language: "de", locale: "de-AT", region: "europe" },
  { code: "BY", name: "Belarus", language: "be", locale: "be-BY", region: "europe" },
  { code: "BE", name: "Belgium", language: "nl", locale: "nl-BE", region: "europe" },
  { code: "BA", name: "Bosnia and Herzegovina", language: "bs", locale: "bs-BA", region: "europe" },
  { code: "BG", name: "Bulgaria", language: "bg", locale: "bg-BG", region: "europe" },
  { code: "HR", name: "Croatia", language: "hr", locale: "hr-HR", region: "europe" },
  { code: "CY", name: "Cyprus", language: "el", locale: "el-CY", region: "europe" },
  { code: "CZ", name: "Czechia", language: "cs", locale: "cs-CZ", region: "europe" },
  { code: "DK", name: "Denmark", language: "da", locale: "da-DK", region: "europe" },
  { code: "EE", name: "Estonia", language: "et", locale: "et-EE", region: "europe" },
  { code: "FI", name: "Finland", language: "fi", locale: "fi-FI", region: "europe" },
  { code: "FR", name: "France", language: "fr", locale: "fr-FR", region: "europe" },
  { code: "GE", name: "Georgia", language: "ka", locale: "ka-GE", region: "europe" },
  { code: "DE", name: "Germany", language: "de", locale: "de-DE", region: "europe" },
  { code: "GR", name: "Greece", language: "el", locale: "el-GR", region: "europe" },
  { code: "HU", name: "Hungary", language: "hu", locale: "hu-HU", region: "europe" },
  { code: "IS", name: "Iceland", language: "is", locale: "is-IS", region: "europe" },
  { code: "IE", name: "Ireland", language: "en", locale: "en-IE", region: "europe" },
  { code: "IT", name: "Italy", language: "it", locale: "it-IT", region: "europe" },
  { code: "XK", name: "Kosovo", language: "sq", locale: "sq-XK", region: "europe" },
  { code: "LV", name: "Latvia", language: "lv", locale: "lv-LV", region: "europe" },
  { code: "LT", name: "Lithuania", language: "lt", locale: "lt-LT", region: "europe" },
  { code: "LU", name: "Luxembourg", language: "fr", locale: "fr-LU", region: "europe" },
  { code: "MT", name: "Malta", language: "mt", locale: "mt-MT", region: "europe" },
  { code: "MD", name: "Moldova", language: "ro", locale: "ro-MD", region: "europe" },
  { code: "ME", name: "Montenegro", language: "sr", locale: "sr-ME", region: "europe" },
  { code: "NL", name: "Netherlands", language: "nl", locale: "nl-NL", region: "europe" },
  { code: "MK", name: "North Macedonia", language: "mk", locale: "mk-MK", region: "europe" },
  { code: "NO", name: "Norway", language: "no", locale: "no-NO", region: "europe" },
  { code: "PL", name: "Poland", language: "pl", locale: "pl-PL", region: "europe" },
  { code: "PT", name: "Portugal", language: "pt", locale: "pt-PT", region: "europe" },
  { code: "RO", name: "Romania", language: "ro", locale: "ro-RO", region: "europe" },
  { code: "RU", name: "Russian Federation", language: "ru", locale: "ru-RU", region: "europe" },
  { code: "RS", name: "Serbia", language: "sr", locale: "sr-RS", region: "europe" },
  { code: "SK", name: "Slovakia", language: "sk", locale: "sk-SK", region: "europe" },
  { code: "SI", name: "Slovenia", language: "sl", locale: "sl-SI", region: "europe" },
  { code: "ES", name: "Spain", language: "es", locale: "es-ES", region: "europe" },
  { code: "SE", name: "Sweden", language: "sv", locale: "sv-SE", region: "europe" },
  { code: "CH", name: "Switzerland", language: "de", locale: "de-CH", region: "europe" },
  { code: "TR", name: "Turkey", language: "tr", locale: "tr-TR", region: "europe" },
  { code: "UA", name: "Ukraine", language: "uk", locale: "uk-UA", region: "europe" },
  { code: "GB", name: "United Kingdom", language: "en", locale: "en-GB", region: "europe" },

  // NORTH AMERICA
  { code: "CA", name: "Canada", language: "en", locale: "en-CA", region: "north_america" },
  { code: "US", name: "United States", language: "en", locale: "en-US", region: "north_america" },
  { code: "MX", name: "Mexico", language: "es", locale: "es-MX", region: "north_america" },

  // CENTRAL AMERICA
  { code: "BZ", name: "Belize", language: "en", locale: "en-BZ", region: "central_america" },
  { code: "CR", name: "Costa Rica", language: "es", locale: "es-CR", region: "central_america" },
  { code: "SV", name: "El Salvador", language: "es", locale: "es-SV", region: "central_america" },
  { code: "GT", name: "Guatemala", language: "es", locale: "es-GT", region: "central_america" },
  { code: "HN", name: "Honduras", language: "es", locale: "es-HN", region: "central_america" },
  { code: "NI", name: "Nicaragua", language: "es", locale: "es-NI", region: "central_america" },
  { code: "PA", name: "Panama", language: "es", locale: "es-PA", region: "central_america" },

  // CARIBBEAN
  { code: "CU", name: "Cuba", language: "es", locale: "es-CU", region: "caribbean" },
  { code: "DO", name: "Dominican Republic", language: "es", locale: "es-DO", region: "caribbean" },
  { code: "HT", name: "Haiti", language: "fr", locale: "fr-HT", region: "caribbean" },
  { code: "JM", name: "Jamaica", language: "en", locale: "en-JM", region: "caribbean" },
  { code: "PR", name: "Puerto Rico", language: "es", locale: "es-PR", region: "caribbean" },
  { code: "TT", name: "Trinidad and Tobago", language: "en", locale: "en-TT", region: "caribbean" },

  // SOUTH AMERICA
  { code: "AR", name: "Argentina", language: "es", locale: "es-AR", region: "south_america" },
  { code: "BO", name: "Bolivia", language: "es", locale: "es-BO", region: "south_america" },
  { code: "BR", name: "Brazil", language: "pt", locale: "pt-BR", region: "south_america" },
  { code: "CL", name: "Chile", language: "es", locale: "es-CL", region: "south_america" },
  { code: "CO", name: "Colombia", language: "es", locale: "es-CO", region: "south_america" },
  { code: "EC", name: "Ecuador", language: "es", locale: "es-EC", region: "south_america" },
  { code: "GY", name: "Guyana", language: "en", locale: "en-GY", region: "south_america" },
  { code: "PY", name: "Paraguay", language: "es", locale: "es-PY", region: "south_america" },
  { code: "PE", name: "Peru", language: "es", locale: "es-PE", region: "south_america" },
  { code: "SR", name: "Suriname", language: "nl", locale: "nl-SR", region: "south_america" },
  { code: "UY", name: "Uruguay", language: "es", locale: "es-UY", region: "south_america" },
  { code: "VE", name: "Venezuela", language: "es", locale: "es-VE", region: "south_america" },

  // AFRICA
  { code: "DZ", name: "Algeria", language: "ar", locale: "ar-DZ", region: "africa" },
  { code: "AO", name: "Angola", language: "pt", locale: "pt-AO", region: "africa" },
  { code: "CM", name: "Cameroon", language: "fr", locale: "fr-CM", region: "africa" },
  { code: "CD", name: "Congo (DRC)", language: "fr", locale: "fr-CD", region: "africa" },
  { code: "CI", name: "Cote d'Ivoire", language: "fr", locale: "fr-CI", region: "africa" },
  { code: "EG", name: "Egypt", language: "ar", locale: "ar-EG", region: "africa" },
  { code: "ET", name: "Ethiopia", language: "am", locale: "am-ET", region: "africa" },
  { code: "GH", name: "Ghana", language: "en", locale: "en-GH", region: "africa" },
  { code: "KE", name: "Kenya", language: "sw", locale: "sw-KE", region: "africa" },
  { code: "LY", name: "Libya", language: "ar", locale: "ar-LY", region: "africa" },
  { code: "MA", name: "Morocco", language: "ar", locale: "ar-MA", region: "africa" },
  { code: "MZ", name: "Mozambique", language: "pt", locale: "pt-MZ", region: "africa" },
  { code: "NG", name: "Nigeria", language: "en", locale: "en-NG", region: "africa" },
  { code: "SN", name: "Senegal", language: "fr", locale: "fr-SN", region: "africa" },
  { code: "ZA", name: "South Africa", language: "en", locale: "en-ZA", region: "africa" },
  { code: "SD", name: "Sudan", language: "ar", locale: "ar-SD", region: "africa" },
  { code: "TZ", name: "Tanzania", language: "sw", locale: "sw-TZ", region: "africa" },
  { code: "TN", name: "Tunisia", language: "ar", locale: "ar-TN", region: "africa" },
  { code: "UG", name: "Uganda", language: "en", locale: "en-UG", region: "africa" },
  { code: "ZW", name: "Zimbabwe", language: "en", locale: "en-ZW", region: "africa" },

  // MIDDLE EAST
  { code: "AF", name: "Afghanistan", language: "ps", locale: "ps-AF", region: "middle_east" },
  { code: "AM", name: "Armenia", language: "hy", locale: "hy-AM", region: "middle_east" },
  { code: "AZ", name: "Azerbaijan", language: "az", locale: "az-AZ", region: "middle_east" },
  { code: "BH", name: "Bahrain", language: "ar", locale: "ar-BH", region: "middle_east" },
  { code: "IR", name: "Iran", language: "fa", locale: "fa-IR", region: "middle_east" },
  { code: "IQ", name: "Iraq", language: "ar", locale: "ar-IQ", region: "middle_east" },
  { code: "IL", name: "Israel", language: "he", locale: "he-IL", region: "middle_east" },
  { code: "JO", name: "Jordan", language: "ar", locale: "ar-JO", region: "middle_east" },
  { code: "KW", name: "Kuwait", language: "ar", locale: "ar-KW", region: "middle_east" },
  { code: "LB", name: "Lebanon", language: "ar", locale: "ar-LB", region: "middle_east" },
  { code: "OM", name: "Oman", language: "ar", locale: "ar-OM", region: "middle_east" },
  { code: "PS", name: "Palestine", language: "ar", locale: "ar-PS", region: "middle_east" },
  { code: "QA", name: "Qatar", language: "ar", locale: "ar-QA", region: "middle_east" },
  { code: "SA", name: "Saudi Arabia", language: "ar", locale: "ar-SA", region: "middle_east" },
  { code: "SY", name: "Syria", language: "ar", locale: "ar-SY", region: "middle_east" },
  { code: "AE", name: "United Arab Emirates", language: "ar", locale: "ar-AE", region: "middle_east" },
  { code: "YE", name: "Yemen", language: "ar", locale: "ar-YE", region: "middle_east" },

  // ASIA
  { code: "BD", name: "Bangladesh", language: "bn", locale: "bn-BD", region: "asia" },
  { code: "KH", name: "Cambodia", language: "km", locale: "km-KH", region: "asia" },
  { code: "CN", name: "China", language: "zh", locale: "zh-CN", region: "asia" },
  { code: "HK", name: "Hong Kong", language: "zh", locale: "zh-HK", region: "asia" },
  { code: "IN", name: "India", language: "hi", locale: "hi-IN", region: "asia" },
  { code: "ID", name: "Indonesia", language: "id", locale: "id-ID", region: "asia" },
  { code: "JP", name: "Japan", language: "ja", locale: "ja-JP", region: "asia" },
  { code: "KZ", name: "Kazakhstan", language: "kk", locale: "kk-KZ", region: "asia" },
  { code: "KR", name: "South Korea", language: "ko", locale: "ko-KR", region: "asia" },
  { code: "MY", name: "Malaysia", language: "ms", locale: "ms-MY", region: "asia" },
  { code: "MN", name: "Mongolia", language: "mn", locale: "mn-MN", region: "asia" },
  { code: "MM", name: "Myanmar", language: "my", locale: "my-MM", region: "asia" },
  { code: "NP", name: "Nepal", language: "ne", locale: "ne-NP", region: "asia" },
  { code: "PK", name: "Pakistan", language: "ur", locale: "ur-PK", region: "asia" },
  { code: "PH", name: "Philippines", language: "en", locale: "en-PH", region: "asia" },
  { code: "SG", name: "Singapore", language: "en", locale: "en-SG", region: "asia" },
  { code: "LK", name: "Sri Lanka", language: "si", locale: "si-LK", region: "asia" },
  { code: "TW", name: "Taiwan", language: "zh", locale: "zh-TW", region: "asia" },
  { code: "TH", name: "Thailand", language: "th", locale: "th-TH", region: "asia" },
  { code: "UZ", name: "Uzbekistan", language: "uz", locale: "uz-UZ", region: "asia" },
  { code: "VN", name: "Vietnam", language: "vi", locale: "vi-VN", region: "asia" },

  // OCEANIA
  { code: "AU", name: "Australia", language: "en", locale: "en-AU", region: "oceania" },
  { code: "FJ", name: "Fiji", language: "en", locale: "en-FJ", region: "oceania" },
  { code: "NZ", name: "New Zealand", language: "en", locale: "en-NZ", region: "oceania" },
];

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export const REGION_LABELS: Record<CountryRegion, string> = {
  europe: "Europe",
  north_america: "North America",
  south_america: "South America",
  central_america: "Central America",
  caribbean: "Caribbean",
  africa: "Africa",
  middle_east: "Middle East",
  asia: "Asia",
  oceania: "Oceania",
};

function getCountryByCode(code: string): Country | undefined {
  return COUNTRY_BY_CODE.get(code.toUpperCase());
}

export function getDefaultLanguageForCountry(code: string): string {
  return getCountryByCode(code)?.language ?? "en";
}

export function getCountriesGroupedByRegion(): Record<CountryRegion, Country[]> {
  const grouped = {} as Record<CountryRegion, Country[]>;
  for (const c of COUNTRIES) {
    (grouped[c.region] ??= []).push(c);
  }
  for (const region of Object.keys(grouped) as CountryRegion[]) {
    grouped[region].sort((a, b) => a.name.localeCompare(b.name));
  }
  return grouped;
}
