import { describe, expect, it } from "vitest";
import { parseProxyCsv, planAssignments } from "./proxy-assignment.mjs";

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

  it("a device without a readable country gets nothing and is not counted short", () => {
    const { assignments, short } = planAssignments([device("parked_probe_box2_b")], proxies);
    expect(assignments[0]).toMatchObject({ country: null, proxy: null });
    expect(short).toEqual({});
  });
});
