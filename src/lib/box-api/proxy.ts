/**
 * Device proxy: read the configured upstream, test real routing through the
 * on-box mihomo engine, write or clear the configuration.
 *
 * `fetchProxyConfig` returns the proxy PASSWORD in clear — never log the raw
 * object (AGENTS.md, measured 9 September 2026).
 */

import { boxFetch, getCfHeaders } from "./fetch";
import type { VmosProxyConfig, VmosResponse } from "./types";

/** What `proxy_get` answers for a device that has no proxy at all (`code 200`, "未设置代理", no `proxy_config`). */
const NO_PROXY: VmosProxyConfig = { enabled: false, proxyType: "", ip: "", port: 0, account: "", password: "" };

/**
 * The configured proxy of a RUNNING device, with the engine it runs on
 * (`engineType`: 1 = host-side mihomo, 0 = in-guest clash — PROXY-STRATEGY.md).
 * A device without any proxy answers `enabled: false` (measured 26 September
 * 2026 on US56: `code 200`, "未设置代理", no `proxy_config`). `null` only when
 * the device could not be asked: container down, or its in-guest proxy service
 * (port 18183) not up yet — cbs_go answers `code 0` "connection refused" for a
 * few seconds after `sys.boot_completed`.
 */
export async function fetchProxyConfig(tunnelHostname: string, dbId: string): Promise<VmosProxyConfig | null> {
  const res = await boxFetch<VmosResponse<{ proxy_config?: VmosProxyConfig; engineType?: number; [key: string]: unknown } | null>>(
    tunnelHostname,
    `/android_api/v1/proxy_get/${dbId}`,
  );
  if (res.code !== 200) return null;
  if (!res.data?.proxy_config) return NO_PROXY;
  return { ...res.data.proxy_config, engineType: res.data.engineType };
}

/**
 * Result of the magicbox-proxy `/proxy-test/{dbId}` connectivity probe. This is
 * a REAL routing test: the box asks the per-container mihomo engine to time a
 * request to a neutral 204 endpoint THROUGH the upstream proxy, so it fails when
 * the upstream is blocked/dead — unlike `proxy_get`, which only reports what is
 * configured. `error` carries the box's machine code (`proxy_not_provisioned`,
 * `engine_unreachable`, `unreachable`, …) for a precise operator message.
 */
export interface ProxyDelayTest {
  ok: boolean;
  delayMs: number | null;
  error: string | null;
  /** Where the engine runs (proxy ≥ 1.3.1): `host` mihomo or `guest` clash. */
  engine: "host" | "guest" | null;
  /** The guest's measured egress, when the box probed it (`guest` engine). */
  exit: { ip: string; country: string | null; city: string | null } | null;
}

/**
 * Probe live proxy reachability via the on-box `/proxy-test/{dbId}` endpoint
 * (magicbox-proxy, NOT a VMOS API). Never throws: transport/HTTP failures are
 * mapped to a typed `{ ok:false, error }` so the caller can always render a
 * result. The container must be running (mihomo only listens while up).
 */
export async function fetchProxyDelayTest(
  tunnelHostname: string,
  dbId: string,
): Promise<ProxyDelayTest> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`https://${tunnelHostname}/proxy-test/${dbId}`, {
      headers: getCfHeaders(),
      cache: "no-store",
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; delayMs?: number; error?: string; engine?: string; exit?: { ip?: string; country?: string | null; city?: string | null } }
      | null;
    if (!body) return { ok: false, delayMs: null, error: `http_${res.status}`, engine: null, exit: null };
    return {
      ok: !!body.ok,
      delayMs: typeof body.delayMs === "number" ? body.delayMs : null,
      error: body.ok ? null : body.error ?? `http_${res.status}`,
      engine: body.engine === "host" || body.engine === "guest" ? body.engine : null,
      exit: body.exit?.ip ? { ip: body.exit.ip, country: body.exit.country ?? null, city: body.exit.city ?? null } : null,
    };
  } catch (err) {
    return {
      ok: false,
      delayMs: null,
      error: err instanceof Error && err.name === "AbortError" ? "timeout" : "transport",
      engine: null,
      exit: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export type ProxyKind = "socks5" | "http";

export interface SetProxyInput {
  proxyType: ProxyKind;
  ip: string;
  port: number;
  account: string;
  password: string;
}

/**
 * Thrown when VMOS refuses `proxy_set` because the container is not running
 * (code 0 / "instance not running"). Verified on box-1..4 (06/2026): the
 * proxy can only be written while the container is up.
 */
export class ProxyTargetNotRunningError extends Error {
  constructor(public readonly dbId: string) {
    super(`Container ${dbId} must be running to update its proxy`);
    this.name = "ProxyTargetNotRunningError";
  }
}

// The one proxy profile every device gets (PROXY-STRATEGY.md § "The method").
// Measured on 26 September 2026 and applied by the operator route and the
// fleet migration alike:
//   - engineType 1 → the host-side mihomo engine. The in-guest engine
//     (engineType 0, the "vpn" mode) leaves the container's traffic on the
//     box's own address for 15–20 s after every boot while its TUN comes up;
//     the host engine routes from the first second.
//   - udpDisabled true → residential SOCKS5 carries no UDP; with UDP allowed
//     QUIC / WebRTC would try the proxy, fail, and the fallback is the raw
//     uplink. TCP-only is what the apps do behind such proxies anyway.
//   - dnsOverProxyDisabled false + dnsServers → names resolve THROUGH the
//     proxy exit, never through the box's resolvers.
export const PROXY_ENGINE_HOST = 1;
export const PROXY_DNS_SERVERS = ["8.8.8.8", "8.8.4.4"];
export const PROXY_UDP_DISABLED = true;
export const PROXY_DNS_OVER_PROXY_DISABLED = false;

/** The `proxy_set` body for one upstream — one definition for every writer. */
export function proxySetPayload(cfg: SetProxyInput) {
  return {
    proxyType: cfg.proxyType,
    proxyName: cfg.proxyType,
    ip: cfg.ip,
    port: cfg.port,
    account: cfg.account,
    password: cfg.password,
    engineType: PROXY_ENGINE_HOST,
    dnsServers: PROXY_DNS_SERVERS,
    udpDisabled: PROXY_UDP_DISABLED,
    dnsOverProxyDisabled: PROXY_DNS_OVER_PROXY_DISABLED,
  };
}

/**
 * Write a proxy onto the device via the VMOS `proxy_set` endpoint.
 *
 * `cbs_go` rewrites the per-container host-side mihomo config and reloads it,
 * and the mihomo delay API answers through the new upstream within ~1 s — but
 * that proves the ENGINE, not the guest: measured on 26 September 2026, the
 * guest of a running device has no egress at all after the write until its
 * next boot (the delay test passed for 160 s while `curl` inside answered
 * nothing; the proxy's exit came back on the next start). Callers restart the
 * container after a successful write (`restartContainer`). Requires the
 * container to be running, otherwise VMOS returns code 0 / "instance not
 * running" (a proxy set at create time is persisted and applied on first
 * start).
 */
export async function setProxyConfig(
  tunnelHostname: string,
  dbId: string,
  cfg: SetProxyInput,
): Promise<void> {
  const res = await boxFetch<VmosResponse<unknown>>(
    tunnelHostname,
    `/android_api/v1/proxy_set/${dbId}`,
    { method: "POST", body: JSON.stringify(proxySetPayload(cfg)) },
  );

  if (res.code === 200) return;
  // The device runs a proxy on the OTHER engine (in-guest clash): cbs_go
  // refuses to switch under it ("存在不同引擎的代理正在运行中，请先关闭代理",
  // measured 26 September 2026). Stop that one, then write ours — every
  // writer (operator route, MCP, migration) moves a device to the one profile
  // the same way.
  if (res.code === 0 && /不同引擎|different engine/i.test(res.msg ?? "")) {
    await clearProxyConfig(tunnelHostname, dbId);
    const retry = await boxFetch<VmosResponse<unknown>>(tunnelHostname, `/android_api/v1/proxy_set/${dbId}`, {
      method: "POST",
      body: JSON.stringify(proxySetPayload(cfg)),
    });
    if (retry.code === 200) return;
    throw new Error(`proxy_set failed after switching engines (code ${retry.code}): ${retry.msg ?? "unknown error"}`);
  }
  if (res.code === 0 || /not running|未运行/i.test(res.msg ?? "")) {
    throw new ProxyTargetNotRunningError(dbId);
  }
  throw new Error(`proxy_set failed (code ${res.code}): ${res.msg ?? "unknown error"}`);
}

/**
 * Disable/clear the proxy on the device via VMOS `proxy_stop`. cbs_go forwards
 * to the container's HTTP service (:18183), tears down the mihomo route, and
 * clears the stored proxy config — the device falls back to a direct
 * connection. Requires the container running (same constraint as `proxy_set`).
 */
export async function clearProxyConfig(tunnelHostname: string, dbId: string): Promise<void> {
  const res = await boxFetch<VmosResponse<unknown>>(
    tunnelHostname,
    `/android_api/v1/proxy_stop/${dbId}`,
  );
  if (res.code === 200) return;
  if (res.code === 0 || /not running|未运行/i.test(res.msg ?? "")) {
    throw new ProxyTargetNotRunningError(dbId);
  }
  throw new Error(`proxy_stop failed (code ${res.code}): ${res.msg ?? "unknown error"}`);
}
