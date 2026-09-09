/**
 * The three packages the maintenance layer watches, and how their
 * `versionCode` maps to a human version — measured against `package/list` on
 * running devices (9 September 2026): X 311970000 = 11.97.0, TikTok
 * 2024509030 = 45.9.3, ADBKeyboard 2 = 2.0.
 *
 * Plain ESM on purpose: the offline audit (`scripts/audit-app-versions.mjs`,
 * run with node) and the server recipes (`app-check.ts`) share this one file.
 */

export const WATCHED_PACKAGES = {
  twitter: "com.twitter.android",
  tiktok: "com.zhiliaoapp.musically",
  adbkeyboard: "com.android.adbkeyboard",
};

/**
 * First X build known to open without the "This app is out of date" wall
 * (12.20.5 and 12.21.1 opened; every build ≤ 11.97 hit the wall). Builds in
 * between are unmeasured and reported as at risk.
 */
export const X_KNOWN_GOOD_VERSION_CODE = 312200000;

/**
 * `311970000` → `11.97.0` (3 · MM · mm · P · bbb).
 * @param {number | null | undefined} code
 * @returns {string | null}
 */
export function twitterVersionName(code) {
  const s = String(code);
  if (!/^3\d{8}$/.test(s)) return null;
  return `${Number(s.slice(1, 3))}.${Number(s.slice(3, 5))}.${Number(s.slice(5, 6))}`;
}

/**
 * `2024509030` → `45.9.3` (20 · 2 · MM · mm · pp · 0).
 * @param {number | null | undefined} code
 * @returns {string | null}
 */
export function tiktokVersionName(code) {
  const s = String(code);
  if (!/^202\d{7}$/.test(s)) return null;
  return `${Number(s.slice(3, 5))}.${Number(s.slice(5, 7))}.${Number(s.slice(7, 9))}`;
}

/**
 * @param {string} pkg
 * @param {number | null | undefined} code
 * @returns {string | null}
 */
export function versionNameFor(pkg, code) {
  if (code == null) return null;
  if (pkg === WATCHED_PACKAGES.twitter) return twitterVersionName(code);
  if (pkg === WATCHED_PACKAGES.tiktok) return tiktokVersionName(code);
  if (pkg === WATCHED_PACKAGES.adbkeyboard) return `${code}.0`;
  return null;
}

/**
 * Wall status of an X build, for the audit summary and the attention queue.
 * @param {number | null | undefined} code
 * @returns {"absent" | "ok" | "walled_or_at_risk"}
 */
export function twitterWallStatus(code) {
  if (code == null) return "absent";
  return code >= X_KNOWN_GOOD_VERSION_CODE ? "ok" : "walled_or_at_risk";
}
