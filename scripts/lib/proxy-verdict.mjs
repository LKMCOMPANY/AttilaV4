/**
 * Pure verdicts over a `/proxy-test` answer — no network, no env, so they are
 * unit-tested against the proxy's own wire fixture
 * (`infra/magicbox-proxy/test/fixtures/proxy-test.json`). The probes that
 * produce the answers live in `proxy-probe.mjs`.
 */

/**
 * The country the avatar is supposed to live in. `user_name` carries it as a
 * prefix (FR90, US2, GB48) and is the value the provisioning flow keys on, so
 * it is the intent; `country` on the row is only filled for some devices.
 */
export function expectedCountry(device) {
  const fromColumn = device.country?.trim().toUpperCase();
  if (fromColumn && fromColumn.length === 2) return fromColumn;
  const match = (device.user_name ?? "").match(/^([A-Za-z]{2})\d/);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Routing verdict from a `/proxy-test` result, honest about stopped devices.
 * Since proxy 1.3.1 the box also probes the in-guest engine ("vpn" mode) and
 * answers `engine: guest` with the guest's `exit`; `unproxied` means the guest
 * leaves through the box's own WAN address — the one verdict that is a leak.
 *
 *   ROUTES     the proxy carries traffic (`delayMs`, and `exit` from a guest engine)
 *   UNPROXIED  the guest egresses through the box's own address
 *   starting   in-guest engine up, TUN not routing yet (poll)
 *   DOWN       engine silent on a running device / upstream did not answer
 *   stopped    nothing to test until the device runs
 *   no-engine  a box on proxy < 1.3.1 could not tell (kept for a not-yet-redeployed box)
 *   FAIL       anything else, verbatim
 */
export function classifyRouting(device, result) {
  const engine = result.engine ? ` (${result.engine} engine)` : "";
  if (result.ok && typeof result.delayMs === "number") return { tag: "ROUTES", detail: `${result.delayMs} ms${engine}`, exit: result.exit ?? null };
  const err = String(result.error ?? "unknown");
  if (/\bunproxied\b/i.test(err)) return { tag: "UNPROXIED", detail: `guest exits through the box's own address${engine}`, exit: result.exit ?? null };
  if (/\bengine_starting\b/i.test(err)) return { tag: "starting", detail: "in-guest engine up, TUN not routing yet" };
  if (/engine_unreachable|ECONNREFUSED|503|timeout/i.test(err)) {
    return device.state === "running"
      ? { tag: "DOWN", detail: "engine down while running — investigate" }
      : { tag: "stopped", detail: "not running (start to test)" };
  }
  if (/proxy_not_provisioned|404/i.test(err)) return { tag: "no-engine", detail: "no host-side engine (proxy < 1.3.1 cannot tell)" };
  if (/unreachable/i.test(err)) return { tag: "DOWN", detail: `upstream proxy did not respond${engine}` };
  return { tag: "FAIL", detail: err.slice(0, 80) };
}

/** Is the measured exit where the persona claims to live? Unknowns are not mismatches. */
export function geoCoherence(device, exit) {
  const expected = expectedCountry(device);
  return { exit, expected, coherent: !exit || !expected || exit.country === expected };
}

/** One-line rendering of a routing verdict for sweep logs. */
export function describeRouting(row) {
  let geo = "";
  if (row.geo) {
    geo = row.geo.exit
      ? `  exit=${row.geo.exit.country}/${row.geo.exit.city ?? "?"}` +
        (row.geo.coherent ? "" : `  MISMATCH (expected ${row.geo.expected})`)
      : "  exit=unreachable";
  }
  return `${row.tag.padEnd(9)} ${row.detail}${geo}`;
}
