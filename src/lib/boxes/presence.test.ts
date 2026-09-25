import { describe, expect, it } from "vitest";
import healthzFixture from "../../../infra/magicbox-proxy/test/fixtures/healthz.json";
import { DEFAULT_HEALTH_THRESHOLDS } from "./host-health";
import { decidePresence, firmwareDue, isUnderMaintenance, stripImageTag, type BoxObservation, type BoxPresenceRow } from "./presence";
import type { ProxyHealthz } from "@/lib/box-api";

const now = new Date("2026-09-25T20:00:00Z");
const row = (over: Partial<BoxPresenceRow> = {}): BoxPresenceRow => ({
  id: "b4",
  tunnel_hostname: "box-4.attila.army",
  status: "offline",
  maintenance_until: null,
  firmware_checked_at: null,
  ...over,
});
const answering: BoxObservation = {
  health: { status: "ok", version: "1.3.0", uptime: 4091.1, containers: 73, api_host: "192.168.1.237", api_source: "default_route", lan_ip: "192.168.1.237" },
  containers: { host_ip: "192.168.1.237", list: [{ db_id: "A", state: "running" }, { db_id: "B", state: "starting" }, { db_id: "C", state: "stopped" }] as never },
};

describe("decidePresence", () => {
  it("brings an answering box online with heartbeat, observed lan_ip and host sample", () => {
    const d = decidePresence(row(), answering, now);
    expect(d.transition).toBe("online");
    expect(d.patch).toMatchObject({ status: "online", uptime_seconds: 4091.1, container_count: 3, lan_ip: "192.168.1.237", last_heartbeat: now.toISOString() });
    expect(d.patch.host_health).toMatchObject({ running: 1, starting: 1, cpu_percent: null });
    expect(d.patch).not.toHaveProperty("model");
  });

  it("prefers /v1/net_info for lan_ip, then the proxy, then list_names", () => {
    expect(decidePresence(row(), { ...answering, net: { host_ip: "10.0.0.9" } }, now).patch.lan_ip).toBe("10.0.0.9");
    const noProxyIp = { ...answering, health: { ...answering.health!, lan_ip: undefined } };
    expect(decidePresence(row(), noProxyIp, now).patch.lan_ip).toBe("192.168.1.237");
  });

  it("writes firmware facts and the image only when they were read", () => {
    const d = decidePresence(
      row(),
      { ...answering, hardware: { device_id: "d", hwaddr: "m", ip: "x", model: "L1", version: "1.1.4.30.1", kernel_version: "2.0.30_marsbox" }, image: "vcloud_android13_edge_20260511192039", system: { cpu: 12, mem_percent: 30, swap_percent: 0 } },
      now,
    );
    expect(d.patch).toMatchObject({ model: "L1", cbs_version: "1.1.4.30.1", kernel_version: "2.0.30_marsbox", default_image: "vcloud_android13_edge_20260511192039", firmware_checked_at: now.toISOString() });
    expect(d.patch.host_health).toMatchObject({ cpu_percent: 12, mem_percent: 30, swap_percent: 0 });
  });

  it("marks a silent box offline once, then leaves it alone", () => {
    expect(decidePresence(row({ status: "online" }), { health: null, containers: null }, now)).toEqual({ transition: "offline", patch: { status: "offline" } });
    expect(decidePresence(row({ status: "offline" }), { health: null, containers: null }, now)).toEqual({ transition: "unchanged", patch: {} });
  });

  it("holds the status during a maintenance window, in both directions", () => {
    const m = row({ status: "online", maintenance_until: "2026-09-25T21:00:00Z" });
    expect(decidePresence(m, { health: null, containers: null }, now)).toEqual({ transition: "held_maintenance", patch: {} });
    const back = decidePresence(row({ status: "offline", maintenance_until: "2026-09-25T21:00:00Z" }), answering, now);
    expect(back.transition).toBe("held_maintenance");
    expect(back.patch).not.toHaveProperty("status");
    expect(back.patch).toHaveProperty("last_heartbeat");
  });

  it("firmware facts are due when never read or older than an hour", () => {
    expect(firmwareDue(row(), now)).toBe(true);
    expect(firmwareDue(row({ firmware_checked_at: "2026-09-25T19:30:00Z" }), now)).toBe(false);
    expect(firmwareDue(row({ firmware_checked_at: "2026-09-25T18:30:00Z" }), now)).toBe(true);
  });

  it("stamps the arbiter's verdict on the host sample", () => {
    const loaded = { ...answering, system: { cpu: 99.2, mem_percent: 61, swap_percent: 100 } };
    expect(decidePresence(row(), loaded, now).patch.host_health).toMatchObject({ verdict: "unhealthy", over: ["cpu 99.2% > 90%", "swap 100% > 60%"] });
    expect(decidePresence(row(), answering, now).patch.host_health).toMatchObject({ verdict: "unknown", over: [] });
    expect(decidePresence(row(), loaded, now, { ...DEFAULT_HEALTH_THRESHOLDS, cpu_percent: 100, swap_percent: 100 }).patch.host_health).toMatchObject({ verdict: "ok" });
  });

  /**
   * Replays `GET /healthz` as magicbox-proxy answers it
   * (`infra/magicbox-proxy/test/fixtures/healthz.json`, asserted by the
   * proxy's own contract test). Every variant must decode; `legacy_1_2_0` is
   * what a not-yet-redeployed box still says and must keep the box online.
   */
  it("decodes every /healthz variant of the proxy fixture", () => {
    const variants = healthzFixture.variants as Record<string, ProxyHealthz>;
    expect(Object.keys(variants).sort()).toEqual(["api_unreachable", "api_unresolved", "legacy_1_2_0", "ok", "override"]);
    const containers = { host_ip: "192.168.1.19", list: [] as never };

    const ok = decidePresence(row(), { health: variants.ok, containers }, now);
    expect(ok.patch).toMatchObject({ status: "online", lan_ip: "192.168.1.19", uptime_seconds: 4091.15, container_count: 0 });

    // The observed address wins over the pinned one a stale drop-in would report.
    expect(decidePresence(row(), { health: variants.override, containers }, now).patch.lan_ip).toBe("192.168.1.16");

    const legacy = decidePresence(row(), { health: variants.legacy_1_2_0, containers }, now);
    expect(legacy.patch).toMatchObject({ status: "online", lan_ip: "192.168.1.19", container_count: 0 });

    // A degraded proxy still answers: the box is reachable, its lan_ip may be unknown.
    const unresolved = decidePresence(row(), { health: variants.api_unresolved, containers: null }, now);
    expect(unresolved.patch).toMatchObject({ status: "online" });
    expect(unresolved.patch).not.toHaveProperty("lan_ip");
    for (const source of healthzFixture.api_source_values) expect(typeof source).toBe("string");
  });

  it("helpers", () => {
    expect(isUnderMaintenance({ maintenance_until: null }, now)).toBe(false);
    expect(isUnderMaintenance({ maintenance_until: "2026-09-25T20:00:01Z" }, now)).toBe(true);
    expect(stripImageTag("vcloud_android13_edge_20260417164945:latest")).toBe("vcloud_android13_edge_20260417164945");
    expect(stripImageTag(null)).toBeNull();
  });
});
