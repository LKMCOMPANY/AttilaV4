import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../infra/magicbox-proxy/test/fixtures/stream-ready.json";
import { STREAM_READY_MESSAGES, waitForStreamReady } from "./stream-readiness";

/**
 * Replays the wire contract of `GET /stream-ready/{db_id}`
 * (`infra/magicbox-proxy/test/fixtures/stream-ready.json`, the file the proxy's
 * own contract test and `StreamReadinessTests.swift` assert too). Every
 * not-ready variant except the fixture's `terminal_reasons` must keep polling;
 * a change to the proxy's reasons is a change on three sides.
 */
type Variant = keyof typeof fixture.variants;

function serve(variant: Variant) {
  const body = fixture.variants[variant];
  const status = fixture.http_status[variant];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })),
  );
}

const wait = () => waitForStreamReady("box", "EDGE0000000000AA", { signal: new AbortController().signal, intervalMs: 1, timeoutMs: 25 });

afterEach(() => vi.unstubAllGlobals());

describe("stream readiness against the proxy fixture", () => {
  it("connects on the ready variant", async () => {
    serve("ready");
    expect(await wait()).toBe("ready");
  });

  it("stops immediately on every terminal reason of the fixture, and only those", async () => {
    expect(fixture.terminal_reasons).toEqual(["projection_dead"]);
    serve("projection_dead");
    const started = Date.now();
    expect(await wait()).toBe("projection-dead");
    expect(Date.now() - started).toBeLessThan(20);
    expect(STREAM_READY_MESSAGES["projection-dead"]?.label.length).toBeLessThanOrEqual(28);
  });

  it("keeps polling through every other not-ready variant until the deadline", async () => {
    const polling = (Object.keys(fixture.variants) as Variant[]).filter(
      (v) => !fixture.variants[v].ready && fixture.http_status[v] === 200 && !fixture.terminal_reasons.includes((fixture.variants[v] as { reason?: string }).reason ?? ""),
    );
    expect(polling).toEqual(["android_down", "not_listed", "resolve_failed", "legacy_1_1_0"]);
    for (const variant of polling) {
      serve(variant);
      expect(await wait(), variant).toBe("timeout");
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length, variant).toBeGreaterThan(1);
    }
  });

  it("falls back to a direct connect when the probe itself is rejected", async () => {
    serve("invalid_db_id");
    expect(await wait()).toBe("unavailable");
  });
});
