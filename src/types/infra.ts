/**
 * Infrastructure rows: the VMOS hosts (`public.boxes`) and their Android
 * containers (`public.devices`). Mirrors the database columns one for one;
 * anything derived lives in `src/lib/boxes/*` and `src/lib/devices/*`.
 */

export type BoxStatus = "online" | "offline";

export type DeviceState = "running" | "stopped" | "creating" | "removed";

/**
 * Whether the container actually boots Android, as measured by a real probe.
 *
 * - `healthy` — came up within the deadline and stayed up.
 * - `unstable` — came up, then dropped out; jobs may fail part-way.
 * - `dead` — never reached `sys.boot_completed`; a black screen for operators.
 */
export type DeviceBootHealth = "healthy" | "unstable" | "dead";

// ---------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------

/**
 * Last host sample written by the presence writer (`src/lib/boxes/presence.ts`)
 * from `/v1/systeminfo` and `list_names`. Percentages are 0–100; `null` when
 * the CBS line does not report the figure. Read by the slot arbiter before a
 * cold start and rendered by both cockpits.
 */
export interface BoxHostHealth {
  /**
   * The arbiter's own reading of this sample against
   * `runtime_settings.boxes.health_thresholds` (`src/lib/boxes/host-health.ts`):
   * `ok`, `unhealthy` (with `over` naming the gauges), `unknown` (no gauge read).
   * Absent on rows written before 25 September 2026 — read as `unknown`.
   */
  verdict?: "ok" | "unhealthy" | "unknown";
  over?: string[];
  cpu_percent: number | null;
  mem_percent: number | null;
  swap_percent: number | null;
  mmc_percent: number | null;
  ssd_percent: number | null;
  /** Containers the box reported as `running` / `starting` at sample time. */
  running: number;
  starting: number;
  sampled_at: string;
}

export interface Box {
  id: string;
  tunnel_hostname: string;
  name: string | null;
  /**
   * OBSERVED LAN address (`/v1/net_info` → `host_ip`, or the proxy's `lan_ip`),
   * written by the presence writer only. The boxes are on DHCP and move
   * between offices: this is never typed, never a routing input.
   */
  lan_ip: string | null;
  status: BoxStatus;
  uptime_seconds: number | null;
  container_count: number;
  max_concurrent_containers: number;
  /**
   * Slots reserved for operators out of `max_concurrent_containers`. The
   * automator may only use `max_concurrent_containers - operator_reserve`, so a
   * live operator always has capacity. Defaults to 1 (migration 20260625090000).
   */
  operator_reserve: number;
  last_heartbeat: string | null;
  metadata: Record<string, unknown>;
  // --- host facts (migration 20260925211052) --------------------------------
  /** Hardware model from `/v1/get_hardware_cfg` (`L1`; box-5 says `E1.01`). */
  model: string | null;
  cbs_version: string | null;
  kernel_version: string | null;
  /** Android image of the first container, repository name without tag. */
  default_image: string | null;
  host_health: BoxHostHealth | null;
  firmware_checked_at: string | null;
  /**
   * Per-box maintenance window. While `now() < maintenance_until` the arbiter
   * refuses `box_maintenance`, the reconcile does not flip `status`, the reaper
   * leaves the box alone and the operator start route refuses.
   */
  maintenance_until: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export interface Device {
  id: string;
  box_id: string;
  account_id: string | null;
  db_id: string;
  user_name: string | null;

  image: string | null;
  aosp_version: string | null;
  resolution: string | null;
  memory_mb: number | null;
  dpi: number | null;
  fps: number | null;
  model: string | null;
  brand: string | null;
  serial: string | null;

  state: DeviceState;
  /**
   * Verdict of the last boot probe — `null` when never probed.
   *
   * Distinct from `state`, and the distinction is the point: VMOS reporting
   * `running` only means the container process is up, not that Android came up
   * inside it. This is `sys.boot_completed` polled to a deadline, so it is the
   * signal that tells an operator whether clicking a device gives them
   * anything.
   */
  boot_health: DeviceBootHealth | null;
  /** Milliseconds to `sys.boot_completed` on the last healthy probe. */
  boot_ms: number | null;
  /** When that verdict was reached — a stale one is aged out, not trusted. */
  boot_checked_at: string | null;
  /**
   * Software the device needs before it can take a job (offline package audit,
   * `scripts/audit-device-packages.mjs`). A device is job-capable only with
   * ADBKeyboard AND at least one social app; `null` = never audited.
   */
  adbkeyboard_installed: boolean | null;
  adbkeyboard_enabled: boolean | null;
  adbkeyboard_checked_at: string | null;
  tiktok_installed: boolean | null;
  twitter_installed: boolean | null;
  packages_checked_at: string | null;
  /**
   * Control API v2 line the guest runs (`"1.1.1"` / `"1.1.3"`), read once from
   * `base/version_info`. The lines differ in how the accessibility tree
   * refreshes after a gesture (measured 9 September 2026), so the engine's
   * reader picks its freshness strategy from this. `null` = never read.
   */
  agent_line: string | null;
  agent_checked_at: string | null;
  screen_state: string | null;
  foreground_app: string | null;
  country: string | null;
  locale: string | null;
  timezone: string | null;
  proxy_enabled: boolean;
  proxy_host: string | null;
  proxy_port: number | null;
  proxy_type: string | null;
  proxy_account: string | null;
  proxy_password: string | null;
  battery_level: number | null;
  docker_ip: string | null;
  tags: string[];
  last_seen: string | null;

  created_at: string;
  updated_at: string;
}

export interface DeviceWithBox extends Device {
  box: Box;
}
