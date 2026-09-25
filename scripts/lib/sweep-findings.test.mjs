import { describe, expect, it } from "vitest";
import { findingsFor, planFindings } from "./sweep-findings.mjs";

const box3 = "box-3.attila.army";
const proxied = (routing) => ({ config: { status: "proxied", detail: "socks5 disp.oxylabs.io:8146" }, routing });
const row = (over) => ({ box: box3, db_id: "EDGE0000000000AA", user_name: "US30", health: "healthy", boot_ms: 15_000, note: null, proxy: null, ...over });

describe("findingsFor", () => {
  it("a healthy device with a coherent proxy is nothing to do", () => {
    const geo = { exit: { ip: "1.2.3.4", country: "US", city: "Boston" }, expected: "US", coherent: true };
    expect(findingsFor(row({ proxy: proxied({ tag: "ROUTES", detail: "800 ms", geo }) }))).toEqual([]);
    expect(findingsFor(row({ proxy: { config: { status: "no_proxy" }, routing: null } }))).toEqual([]);
  });

  it("a dead device is critical, with the sweep's own words", () => {
    const [f] = findingsFor(row({ health: "dead", note: "no boot_completed in 120s" }));
    expect(f).toMatchObject({ reason: "boot_dead", severity: "critical", detail: "dead: no boot_completed in 120s" });
  });

  it("a guest leaving through the box is a critical leak; a wrong country or a silent engine is a warning", () => {
    const leak = findingsFor(row({ proxy: proxied({ tag: "UNPROXIED", detail: "…", geo: { exit: { ip: "145.224.95.86", country: "FR" }, expected: "US", coherent: false } }) }));
    expect(leak).toHaveLength(1);
    expect(leak[0]).toMatchObject({ reason: "proxy_incoherent", severity: "critical" });
    expect(leak[0].detail).toContain("145.224.95.86");

    const wrong = findingsFor(row({ proxy: proxied({ tag: "ROUTES", detail: "959 ms", geo: { exit: { ip: "151.241.63.63", country: "GB", city: "London" }, expected: "US", coherent: false } }) }));
    expect(wrong[0]).toMatchObject({ reason: "proxy_incoherent", severity: "warning", title: "Proxy of US30 exits in GB, persona is US" });

    const down = findingsFor(row({ proxy: proxied({ tag: "DOWN", detail: "engine down while running — investigate" }) }));
    expect(down[0]).toMatchObject({ severity: "warning" });
    expect(down[0].detail).toContain("DOWN");
  });

  it("a device can be both dead and mis-proxied", () => {
    const both = findingsFor(row({ health: "unstable", note: "booted then died", proxy: proxied({ tag: "DOWN", detail: "x" }) }));
    expect(both.map((f) => f.reason)).toEqual(["boot_dead", "proxy_incoherent"]);
  });
});

describe("planFindings", () => {
  const mismatch = (name, box = box3) =>
    row({ box, user_name: name, proxy: proxied({ tag: "ROUTES", detail: "1 ms", geo: { exit: { ip: "1.1.1.1", country: "GB" }, expected: "US", coherent: false } }) });

  it("folds a systemic box problem into one entry, keeps the rest per device", () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => mismatch(`US${i}`)),
      mismatch("GB41", "box-4.attila.army"),
      row({ box: "box-1.attila.army", user_name: "FR4", health: "dead" }),
    ];
    const plan = planFindings(rows, 10);
    expect(plan.perBox).toHaveLength(1);
    expect(plan.perBox[0].box).toBe(box3);
    expect(plan.perBox[0].findings).toHaveLength(12);
    expect(plan.perDevice.map((p) => p.row.user_name).sort()).toEqual(["FR4", "GB41"]);
  });

  it("boot findings never fold, whatever the count", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row({ user_name: `D${i}`, health: "dead" }));
    const plan = planFindings(rows, 10);
    expect(plan.perBox).toEqual([]);
    expect(plan.perDevice).toHaveLength(30);
  });
});
