import { describe, expect, it } from "vitest";
import { categorizeFailure, RETRYABLE_CATEGORIES } from "./failures";

// The exact messages of the 30 `unknown` failures of 18–25 September 2026.
describe("categorizeFailure", () => {
  it("names the stale v2 route after a container restart", () => {
    expect(categorizeFailure(new Error("Control API input/scroll_bezier on EDGE7E4R39VINZ56 → code 0: 请求容器失败: dial tcp 172.17.0.3:18185: connect: no route to host"))).toBe("agent_unreachable");
    expect(categorizeFailure(new Error("Control API input/scroll_bezier on EDGE9Z52CEK0M9ZD → code 0: 请求容器失败: dial tcp 172.17.0.2:18185: connect: connection refused"))).toBe("agent_unreachable");
  });

  it("names a container stopped under the session", () => {
    expect(categorizeFailure(new Error("Control API input/scroll_bezier on EDGEIASHK37SZVNA → code 0: instance not running, current state: stopped"))).toBe("container_stopped");
    expect(categorizeFailure(new Error("Control API input/scroll_bezier on EDGEBURHD4KCCOYW → code 0: instance not running, current state: stopping"))).toBe("container_stopped");
  });

  it("names the tunnel", () => {
    expect(categorizeFailure(new Error("Box API error: 502 Bad Gateway — https://box-1.attila.army/android_api/v1/shell/EDGESJFXEAJ7NS1U"))).toBe("box_unreachable");
    expect(categorizeFailure(new Error("Box API timeout after 30000ms — https://box-1.attila.army/android_api/v2/EDGEIASHK37SZVNA/input/scroll_bezier"))).toBe("box_unreachable");
  });

  it("keeps the residue honest and retries only what is transient", () => {
    expect(categorizeFailure(new Error("something nobody has seen"))).toBe("unknown");
    expect(RETRYABLE_CATEGORIES.has("unknown")).toBe(false);
    expect(RETRYABLE_CATEGORIES.has("agent_unreachable")).toBe(true);
  });
});
