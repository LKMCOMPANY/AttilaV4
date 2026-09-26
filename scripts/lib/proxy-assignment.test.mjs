import { describe, expect, it } from "vitest";
import { parseProxyCsv, planAssignments, proxyKey, reserveProxies } from "./proxy-assignment.mjs";

const csv = `country,host,port,username,password,city
US,isp.oxylabs.io,8001,user-cc-US-a,s1,Boston
us,isp.oxylabs.io,8002,user-cc-US-b,s2,
FR,isp.oxylabs.io,8101,user-cc-FR-a,s3,Paris
# a comment line
GB,isp.oxylabs.io,8201,user-cc-GB-a,s4,London
`;

describe("parseProxyCsv", () => {
  it("reads the header, upper-cases the country, keeps an optional city", () => {
    const rows = parseProxyCsv(csv);
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual({ country: "US", host: "isp.oxylabs.io", port: 8002, username: "user-cc-US-b", password: "s2", city: undefined });
    expect(rows[2].city).toBe("Paris");
  });

  it("refuses a bad list whole: missing column, bad port, bad country, duplicate", () => {
    expect(() => parseProxyCsv("host,port,username,password\na,1,u,p")).toThrow(/misses "country"/);
    expect(() => parseProxyCsv("country,host,port,username,password\nUS,a,99999,u,p")).toThrow(/bad port/);
    expect(() => parseProxyCsv("country,host,port,username,password\nUSA,a,1,u,p")).toThrow(/bad country/);
    expect(() => parseProxyCsv("country,host,port,username,password\nUS,a,1,u,p\nUS,a,1,u,p")).toThrow(/duplicate/);
    expect(() => parseProxyCsv("country,host,port,username,password\nUS,a,1,,p")).toThrow(/required/);
  });
});

describe("planAssignments", () => {
  const proxies = parseProxyCsv(csv);
  const device = (user_name, country = null) => ({ id: user_name, db_id: `EDGE${user_name}`, user_name, country });

  it("gives each device a proxy of its country, in user_name order, and reports spare and short", () => {
    const { assignments, spare, short } = planAssignments([device("US2"), device("FR1"), device("US1"), device("GB41", "cn"), device("ES3")], proxies);
    expect(assignments.map((a) => [a.device.user_name, a.country, a.proxy?.port ?? null])).toEqual([
      ["ES3", "ES", null],
      ["FR1", "FR", 8101],
      ["GB41", "CN", null],
      ["US1", "US", 8001],
      ["US2", "US", 8002],
    ]);
    expect(spare).toEqual({ GB: 1 });
    expect(short).toEqual({ ES: 1, CN: 1 });
  });

  it("is deterministic: the same list and devices give the same pairs", () => {
    const a = planAssignments([device("US2"), device("US1")], proxies).assignments.map((x) => x.proxy?.port);
    const b = planAssignments([device("US1"), device("US2")], proxies).assignments.map((x) => x.proxy?.port);
    expect(a).toEqual(b);
  });

  it("never hands out a proxy another device holds, and lets a device keep its own", () => {
    const reserved = new Map([
      [proxyKey("isp.oxylabs.io", 8001), "other-device"], // held elsewhere → withheld
      [proxyKey("isp.oxylabs.io", 8101), "FR1"], // held by FR1 itself → FR1 keeps it
    ]);
    const { assignments, spare, short, reserved: withheld } = planAssignments([device("US1"), device("US2"), device("FR1")], proxies, { reserved });
    expect(withheld).toBe(1);
    expect(assignments.map((a) => [a.device.user_name, a.proxy?.port ?? null])).toEqual([["FR1", 8101], ["US1", 8002], ["US2", null]]);
    expect(short).toEqual({ US: 1 });
    expect(spare).toEqual({ GB: 1 });
  });

  it("a holder sorted after the taker still keeps its proxy; the taker gets the next free one", () => {
    // US1 is planned before US9 (user_name order) but US9 already holds 8001.
    const reserved = new Map([[proxyKey("isp.oxylabs.io", 8001), "US9"]]);
    const { assignments, spare, short } = planAssignments([device("US1"), device("US9"), device("US5")], proxies, { reserved });
    expect(assignments.map((a) => [a.device.user_name, a.proxy?.port ?? null])).toEqual([["US1", 8002], ["US5", null], ["US9", 8001]]);
    expect(short).toEqual({ US: 1 });
    expect(spare).toEqual({ FR: 1, GB: 1 });
  });

  it("a proxy held by a device of another country is neither handed out nor counted spare", () => {
    const reserved = new Map([[proxyKey("isp.oxylabs.io", 8201), "GB41"]]); // GB41's row says CN
    const { assignments, spare } = planAssignments([device("GB41", "CN"), device("GB1")], proxies, { reserved });
    expect(assignments.map((a) => [a.device.user_name, a.proxy?.port ?? null])).toEqual([["GB1", null], ["GB41", null]]);
    expect(spare).toEqual({ US: 2, FR: 1 });
  });

  it("a device without a readable country gets nothing and is not counted short", () => {
    const { assignments, short } = planAssignments([device("parked_probe_box2_b")], proxies);
    expect(assignments[0]).toMatchObject({ country: null, proxy: null });
    expect(short).toEqual({});
  });
});

describe("reserveProxies", () => {
  // Holders come sorted by user_name, as the fetch returns them.
  const holder = (id, port, box = "box-1", status = "online") => ({ id, proxy_host: "isp.oxylabs.io", proxy_port: port, boxes: { tunnel_hostname: box, status } });
  const onBox5 = (h) => h.boxes.tunnel_hostname === "box-5";

  it("reserves every holding for its holder and reports nothing contested", () => {
    const { reserved, reclaimed, contested } = reserveProxies([holder("GB1", 8001), holder("GB2", 8002), { id: "none", proxy_host: null, proxy_port: null }]);
    expect([...reserved]).toEqual([[proxyKey("isp.oxylabs.io", 8001), "GB1"], [proxyKey("isp.oxylabs.io", 8002), "GB2"]]);
    expect(reclaimed).toBe(0);
    expect(contested.size).toBe(0);
  });

  it("a gateway's shared port is neither reserved nor contested — the session is in the username", () => {
    const gate = (id) => ({ id, proxy_host: "gate.nodemaven.com", proxy_port: 1080, boxes: { tunnel_hostname: "box-1", status: "online" } });
    const { reserved, contested } = reserveProxies([gate("US1"), gate("US2"), holder("GB1", 8001)]);
    expect([...reserved.keys()]).toEqual([proxyKey("isp.oxylabs.io", 8001)]);
    expect(contested.size).toBe(0);
  });

  it("a contested port goes to the first holder by name and is reported", () => {
    const { reserved, reclaimed, contested } = reserveProxies([holder("FR25", 8003, "box-3"), holder("FR67", 8003, "box-5")]);
    expect(reserved.get(proxyKey("isp.oxylabs.io", 8003))).toBe("FR25");
    expect(reclaimed).toBe(0);
    expect([...contested.keys()]).toEqual([proxyKey("isp.oxylabs.io", 8003)]);
  });

  it("with reclaim, the holder outside the reclaimed scope keeps a contested port whatever the order", () => {
    const { reserved, reclaimed } = reserveProxies([holder("GB52", 8006, "box-5"), holder("GB26", 8006, "box-3")], { reclaim: onBox5 });
    expect(reserved.get(proxyKey("isp.oxylabs.io", 8006))).toBe("GB26");
    expect(reclaimed).toBe(1);
  });

  it("a port the reclaimed box holds alone stays its own; two reclaimed holders — the first keeps it", () => {
    const { reserved, reclaimed } = reserveProxies([holder("GB100", 8044, "box-5"), holder("GB52", 8044, "box-5"), holder("GB53", 8121, "box-5")], { reclaim: onBox5 });
    expect(reserved.get(proxyKey("isp.oxylabs.io", 8044))).toBe("GB100");
    expect(reserved.get(proxyKey("isp.oxylabs.io", 8121))).toBe("GB53");
    expect(reclaimed).toBe(1);
  });
});
