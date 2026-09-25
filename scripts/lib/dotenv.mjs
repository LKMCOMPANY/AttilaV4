import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The ONE `.env` reader of the terminal scripts (`scripts/*`, `infra/boxes/scripts/*`).
 * Never overrides a variable already set; strips matching quotes; ignores
 * comments and blank lines. The web app reads `.env.local` through Next; the
 * scripts run under plain node/tsx and need this.
 */
export function loadEnvFile(path) {
  if (!existsSync(path)) return false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
  return true;
}

/** `.env.local` of the app (Supabase, CF Access, Aleria, TikHub …). */
export function loadDotEnvLocal(cwd = process.cwd()) {
  loadEnvFile(resolve(cwd, ".env.local"));
}

/** The Cloudflare Access service token as request headers — the JS twin of `getCfHeaders` (src/lib/box-api/fetch.ts). */
export function cfAccessHeaders() {
  return {
    "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
    "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET,
  };
}
