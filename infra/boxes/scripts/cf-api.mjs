/**
 * READ-ONLY Cloudflare API helpers for the fleet drift checker.
 *
 * Uses a scoped API token (`CLOUDFLARE_API_TOKEN`) — this is SEPARATE from the
 * Cloudflare Access service token (`CF_ACCESS_*`) that authenticates the box
 * HTTP tunnels. The token only needs read scopes:
 *   - Zone       → DNS: Read            (verify the box CNAMEs)
 *   - Account    → Cloudflare Tunnel: Read (tunnel health + cloudflared version)
 *
 * Every call here is GET-only; it never mutates Cloudflare state. When the
 * token is absent the caller simply skips the Cloudflare section.
 */

const API = "https://api.cloudflare.com/client/v4";

async function cf(token, path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!json || !json.success) {
    const msg = json?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API ${path}: ${msg}`);
  }
  return json.result;
}

/** Resolve the zone id + account id for a zone name (e.g. `attila.army`). */
export async function resolveZone(token, zoneName) {
  const zones = await cf(token, `/zones?name=${encodeURIComponent(zoneName)}`);
  if (!zones.length) throw new Error(`zone not found: ${zoneName}`);
  return { zoneId: zones[0].id, accountId: zones[0].account.id, name: zones[0].name };
}

/** All DNS records for the zone, normalized to `{ name, type, content, proxied }`. */
export async function listDnsRecords(token, zoneId) {
  const records = await cf(token, `/zones/${zoneId}/dns_records?per_page=500`);
  return records.map((r) => ({
    name: r.name,
    type: r.type,
    content: r.content,
    proxied: !!r.proxied,
  }));
}

/**
 * All non-deleted named tunnels with health + the distinct cloudflared client
 * versions currently connected (one box may hold several connections).
 */
export async function listTunnels(token, accountId) {
  const tunnels = await cf(token, `/accounts/${accountId}/cfd_tunnel?is_deleted=false&per_page=100`);
  return tunnels.map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    versions: [...new Set((t.connections || []).map((c) => c.client_version).filter(Boolean))],
  }));
}

/**
 * The remote (dashboard/API-managed) tunnel configuration, or `null` when the
 * tunnel is purely locally-managed. A populated `config.ingress` means there is
 * a SECOND source of truth for the ingress (competing with the versioned
 * `/etc/cloudflared/config.yml`) — the drift checker flags it for removal.
 */
export async function getTunnelRemoteConfig(token, accountId, tunnelId) {
  try {
    const cfg = await cf(token, `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`);
    const ingress = cfg?.config?.ingress;
    return Array.isArray(ingress) && ingress.length > 0
      ? { version: cfg.version, ingressCount: ingress.length }
      : null;
  } catch {
    return null;
  }
}
