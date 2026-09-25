import { describe, expect, it } from "vitest";
import fixture from "../../infra/magicbox-proxy/test/fixtures/proxy-test.json";
import { classifyRouting, describeRouting, expectedCountry, geoCoherence } from "./proxy-verdict.mjs";

/**
 * Replays the proxy's own `/proxy-test` wire contract
 * (`infra/magicbox-proxy/test/fixtures/proxy-test.json`) through the sweep's
 * verdicts, so a reason added on the box is a change here too.
 */
const running = { db_id: "EDGE7BM34VZ2S3J9", user_name: "US30", state: "running", country: null };
const stopped = { ...running, state: "stopped" };

describe("classifyRouting against the proxy fixture", () => {
  const v = fixture.variants;

  it("reads every variant as the contract intends", () => {
    expect(classifyRouting(running, v.host_routes)).toMatchObject({ tag: "ROUTES", detail: "813 ms (host engine)", exit: null });
    expect(classifyRouting(running, v.legacy_1_3_0)).toMatchObject({ tag: "ROUTES", detail: "813 ms" });
    expect(classifyRouting(running, v.guest_routes)).toMatchObject({ tag: "ROUTES", exit: v.guest_routes.exit });
    expect(classifyRouting(running, v.guest_unproxied)).toMatchObject({ tag: "UNPROXIED", exit: v.guest_unproxied.exit });
    expect(classifyRouting(running, v.guest_engine_starting).tag).toBe("starting");
    expect(classifyRouting(running, v.host_unreachable)).toMatchObject({ tag: "DOWN", detail: "upstream proxy did not respond (host engine)" });
    expect(classifyRouting(running, v.guest_unreachable).tag).toBe("DOWN");
    expect(classifyRouting(running, v.invalid_db_id).tag).toBe("FAIL");
  });

  it("a silent engine is DOWN on a running device and stopped otherwise", () => {
    expect(classifyRouting(running, v.engine_unreachable).tag).toBe("DOWN");
    expect(classifyRouting(stopped, v.engine_unreachable).tag).toBe("stopped");
  });

  it("keeps reading a box that still runs proxy 1.3.0", () => {
    expect(classifyRouting(running, { ok: false, error: "HTTP 404 Not Found → proxy_not_provisioned" }).tag).toBe("no-engine");
  });

  it("every fixture variant maps to a known tag", () => {
    const tags = new Set(["ROUTES", "UNPROXIED", "starting", "DOWN", "stopped", "no-engine", "FAIL"]);
    for (const variant of Object.values(v)) expect(tags.has(classifyRouting(running, variant).tag)).toBe(true);
  });
});

describe("geo coherence", () => {
  it("takes the persona's country from the row, then from the user_name prefix", () => {
    expect(expectedCountry({ user_name: "FR90", country: null })).toBe("FR");
    expect(expectedCountry({ user_name: "GB41", country: "cn" })).toBe("CN");
    expect(expectedCountry({ user_name: "parked_probe_box2_b", country: null })).toBeNull();
  });

  it("only a known exit against a known persona can mismatch", () => {
    expect(geoCoherence({ user_name: "US30", country: null }, { ip: "151.241.63.63", country: "GB", city: "London" }).coherent).toBe(false);
    expect(geoCoherence({ user_name: "GB12", country: null }, { ip: "1.2.3.4", country: "GB", city: "London" }).coherent).toBe(true);
    expect(geoCoherence({ user_name: "US30", country: null }, null).coherent).toBe(true);
    expect(geoCoherence({ user_name: "spare", country: null }, { ip: "1.2.3.4", country: "FR" }).coherent).toBe(true);
  });

  it("renders the mismatch where a human reads the log", () => {
    const row = { tag: "ROUTES", detail: "959 ms (guest engine)", geo: geoCoherence({ user_name: "US30", country: null }, { ip: "1.1.1.1", country: "GB", city: "London" }) };
    expect(describeRouting(row)).toBe("ROUTES    959 ms (guest engine)  exit=GB/London  MISMATCH (expected US)");
    expect(describeRouting({ tag: "ROUTES", detail: "1 ms", geo: { exit: null, expected: "US", coherent: true } })).toContain("exit=unreachable");
  });
});
