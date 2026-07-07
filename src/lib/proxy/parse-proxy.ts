/**
 * Proxy string parser — shared by the operator proxy editor (paste support) and
 * server-side validation. Pure + dependency-free so it runs in both the browser
 * and server actions.
 *
 * Accepted formats (in priority order):
 *   1. URL          socks5://user:pass@host:port  ·  http://user:pass@host:port
 *   2. creds@host   user:pass@host:port
 *   3. colon tuple  host:port:user:pass           (Oxylabs style; user may
 *                   itself contain ':' — everything between port and the last
 *                   field is the username, matching MagicBox-Industrial)
 *   4. host:port    (no auth)
 *
 * Returns null for anything that doesn't yield a host + valid port. Defaults to
 * SOCKS5 (the recommended protocol) unless a URL scheme says otherwise.
 */

export type ProxyKind = "socks5" | "http";

export interface ParsedProxy {
  proxyType: ProxyKind;
  host: string;
  port: number;
  account: string;
  password: string;
}

function toPort(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : null;
}

function schemeToKind(scheme: string): ProxyKind {
  return /^socks/i.test(scheme) ? "socks5" : "http";
}

export function parseProxyString(raw: string): ParsedProxy | null {
  const input = raw.trim();
  if (!input) return null;

  // 1. Full URL form (socks5://, socks5h://, http://, https://).
  const schemeMatch = input.match(/^([a-z0-9]+):\/\//i);
  if (schemeMatch) {
    try {
      const u = new URL(input);
      const port = toPort(u.port);
      if (!u.hostname || port == null) return null;
      return {
        proxyType: schemeToKind(schemeMatch[1]),
        host: u.hostname,
        port,
        account: decodeURIComponent(u.username || ""),
        password: decodeURIComponent(u.password || ""),
      };
    } catch {
      return null;
    }
  }

  // 2. creds@host form: user:pass@host:port
  if (input.includes("@")) {
    const at = input.lastIndexOf("@");
    const creds = input.slice(0, at);
    const hostPort = input.slice(at + 1);
    const [host, portRaw] = splitLast(hostPort, ":");
    const port = portRaw ? toPort(portRaw) : null;
    if (!host || port == null) return null;
    const [account, password] = splitFirst(creds, ":");
    return { proxyType: "socks5", host, port, account, password: password ?? "" };
  }

  // 3 & 4. Colon tuple: host:port[:user[:...:pass]]
  const parts = input.split(":");
  if (parts.length < 2) return null;
  const host = parts[0];
  const port = toPort(parts[1] ?? "");
  if (!host || port == null) return null;

  if (parts.length === 2) return { proxyType: "socks5", host, port, account: "", password: "" };
  if (parts.length === 3) return { proxyType: "socks5", host, port, account: parts[2], password: "" };
  // 4+: username is everything between the port and the final password field.
  const password = parts[parts.length - 1];
  const account = parts.slice(2, -1).join(":");
  return { proxyType: "socks5", host, port, account, password };
}

function splitFirst(s: string, sep: string): [string, string | undefined] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)];
}

function splitLast(s: string, sep: string): [string, string | undefined] {
  const i = s.lastIndexOf(sep);
  return i < 0 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)];
}
