export interface Language {
  code: string;
  name: string;
  nativeName: string;
}

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "zh", name: "Chinese", nativeName: "\u4e2d\u6587" },
  { code: "es", name: "Spanish", nativeName: "Espa\u00f1ol" },
  { code: "ar", name: "Arabic", nativeName: "\u0627\u0644\u0639\u0631\u0628\u064a\u0629" },
  { code: "hi", name: "Hindi", nativeName: "\u0939\u093f\u0928\u094d\u0926\u0940" },
  { code: "pt", name: "Portuguese", nativeName: "Portugu\u00eas" },
  { code: "bn", name: "Bengali", nativeName: "\u09ac\u09be\u0982\u09b2\u09be" },
  { code: "ru", name: "Russian", nativeName: "\u0420\u0443\u0441\u0441\u043a\u0438\u0439" },
  { code: "ja", name: "Japanese", nativeName: "\u65e5\u672c\u8a9e" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "fr", name: "French", nativeName: "Fran\u00e7ais" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "pl", name: "Polish", nativeName: "Polski" },
  { code: "uk", name: "Ukrainian", nativeName: "\u0423\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0430" },
  { code: "ro", name: "Romanian", nativeName: "Rom\u00e2n\u0103" },
  { code: "el", name: "Greek", nativeName: "\u0395\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac" },
  { code: "cs", name: "Czech", nativeName: "\u010ce\u0161tina" },
  { code: "sv", name: "Swedish", nativeName: "Svenska" },
  { code: "hu", name: "Hungarian", nativeName: "Magyar" },
  { code: "bg", name: "Bulgarian", nativeName: "\u0411\u044a\u043b\u0433\u0430\u0440\u0441\u043a\u0438" },
  { code: "da", name: "Danish", nativeName: "Dansk" },
  { code: "fi", name: "Finnish", nativeName: "Suomi" },
  { code: "sk", name: "Slovak", nativeName: "Sloven\u010dina" },
  { code: "no", name: "Norwegian", nativeName: "Norsk" },
  { code: "hr", name: "Croatian", nativeName: "Hrvatski" },
  { code: "ca", name: "Catalan", nativeName: "Catal\u00e0" },
  { code: "lt", name: "Lithuanian", nativeName: "Lietuvi\u0173" },
  { code: "sl", name: "Slovenian", nativeName: "Sloven\u0161\u010dina" },
  { code: "lv", name: "Latvian", nativeName: "Latvie\u0161u" },
  { code: "et", name: "Estonian", nativeName: "Eesti" },
  { code: "sr", name: "Serbian", nativeName: "\u0421\u0440\u043f\u0441\u043a\u0438" },
  { code: "bs", name: "Bosnian", nativeName: "Bosanski" },
  { code: "mk", name: "Macedonian", nativeName: "\u041c\u0430\u043a\u0435\u0434\u043e\u043d\u0441\u043a\u0438" },
  { code: "sq", name: "Albanian", nativeName: "Shqip" },
  { code: "mt", name: "Maltese", nativeName: "Malti" },
  { code: "is", name: "Icelandic", nativeName: "\u00cdslenska" },
  { code: "be", name: "Belarusian", nativeName: "\u0411\u0435\u043b\u0430\u0440\u0443\u0441\u043a\u0430\u044f" },
  { code: "ko", name: "Korean", nativeName: "\ud55c\uad6d\uc5b4" },
  { code: "vi", name: "Vietnamese", nativeName: "Ti\u1ebfng Vi\u1ec7t" },
  { code: "th", name: "Thai", nativeName: "\u0e44\u0e17\u0e22" },
  { code: "tr", name: "Turkish", nativeName: "T\u00fcrk\u00e7e" },
  { code: "fa", name: "Persian", nativeName: "\u0641\u0627\u0631\u0633\u06cc" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "ms", name: "Malay", nativeName: "Bahasa Melayu" },
  { code: "ur", name: "Urdu", nativeName: "\u0627\u0631\u062f\u0648" },
  { code: "ne", name: "Nepali", nativeName: "\u0928\u0947\u092a\u093e\u0932\u0940" },
  { code: "si", name: "Sinhala", nativeName: "\u0dc3\u0dd2\u0d82\u0dc4\u0dbd" },
  { code: "km", name: "Khmer", nativeName: "\u1781\u17d2\u1798\u17c2\u179a" },
  { code: "ka", name: "Georgian", nativeName: "\u10e5\u10d0\u10e0\u10d7\u10e3\u10da\u10d8" },
  { code: "hy", name: "Armenian", nativeName: "\u0540\u0561\u0575\u0565\u0580\u0565\u0576" },
  { code: "az", name: "Azerbaijani", nativeName: "Az\u0259rbaycan" },
  { code: "kk", name: "Kazakh", nativeName: "\u049a\u0430\u0437\u0430\u049b" },
  { code: "uz", name: "Uzbek", nativeName: "O\u02bbzbek" },
  { code: "mn", name: "Mongolian", nativeName: "\u041c\u043e\u043d\u0433\u043e\u043b" },
  { code: "he", name: "Hebrew", nativeName: "\u05e2\u05d1\u05e8\u05d9\u05ea" },
  { code: "sw", name: "Swahili", nativeName: "Kiswahili" },
  { code: "am", name: "Amharic", nativeName: "\u12a0\u121b\u122d\u129b" },
  { code: "ha", name: "Hausa", nativeName: "Hausa" },
  { code: "af", name: "Afrikaans", nativeName: "Afrikaans" },
  { code: "ps", name: "Pashto", nativeName: "\u067e\u069a\u062a\u0648" },
  { code: "my", name: "Burmese", nativeName: "\u1019\u103c\u1014\u103a\u1019\u102c\u1018\u102c\u101e\u102c" },
  { code: "lo", name: "Lao", nativeName: "\u0ea5\u0eb2\u0ea7" },
];

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

const LANGUAGE_BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

function getLanguageByCode(code: string): Language | undefined {
  return LANGUAGE_BY_CODE.get(code.toLowerCase());
}

export function getLanguageName(code: string): string {
  return getLanguageByCode(code)?.name ?? code;
}

export function getLanguagesForSelect(): Array<{ code: string; name: string; nativeName: string }> {
  return LANGUAGES.map((l) => ({
    code: l.code,
    name: l.name,
    nativeName: l.nativeName,
  })).sort((a, b) => a.name.localeCompare(b.name));
}
