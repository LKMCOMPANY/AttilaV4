/**
 * Server-side client of the box APIs, reached through the Cloudflare tunnel.
 *
 * Layered architecture:
 *   - `fetch`       : `boxFetch` / `boxFetchBytes`, the single HTTP primitive (CF auth,
 *                     timeouts, bounded retries)
 *   - `containers`  : Container API v1 reads (inventory, detail, timezone)
 *   - `shell`       : `shell` (throws on container-not-ready), `shellSafe`, `screenshot`
 *   - `proxy`       : proxy read / routing test / write / clear
 *   - `lifecycle`   : `ensureContainerReady` (boot + `sys.boot_completed`), start, stop
 *   - `control-v2`  : Android Control API v2 (tree, selectors, gestures, packages)
 *
 * Android-level helpers (wake, IME, text input, focus tracking) live in
 * `src/lib/automation/adb-helpers.ts` on top of these; the maintenance engine
 * (`src/lib/engine`) composes `control-v2` and `shell`.
 */

export { boxFetch, boxFetchBytes, getCfHeaders, type BoxFetchInit } from "./fetch";
export type {
  VmosContainer,
  VmosContainerDetail,
  VmosTimezoneLocale,
  VmosProxyConfig,
} from "./types";
export {
  fetchHealthz,
  fetchContainerList,
  fetchContainerDetail,
  fetchTimezoneLocale,
  aospFromDetail,
} from "./containers";
export { ContainerNotReadyError, shell, shellSafe, screenshot, type ShellResult } from "./shell";
export {
  fetchProxyConfig,
  fetchProxyDelayTest,
  setProxyConfig,
  clearProxyConfig,
  ProxyTargetNotRunningError,
  type ProxyDelayTest,
  type ProxyKind,
  type SetProxyInput,
} from "./proxy";
export {
  ensureContainerReady,
  fetchRomStatus,
  startContainerProcess,
  stopContainer,
  stopContainerIfIdle,
} from "./lifecycle";
export {
  ControlApiError,
  fetchControlApiVersion,
  waitForControlApi,
  fetchDumpCompact,
  fetchDumpCompactInGuest,
  fetchScreenshotJpeg,
  queryNodes,
  actOnNode,
  scrollBezier,
  fetchPackageList,
  fetchPackageInfo,
  type ControlApiVersion,
  type V2Selector,
  type V2NodeAction,
  type V2Node,
  type V2PackageInfo,
  type BezierScroll,
} from "./control-v2";
