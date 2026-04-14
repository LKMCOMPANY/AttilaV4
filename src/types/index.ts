export type UserRole = "admin" | "manager" | "operator";

export type AccountStatus = "active" | "standby" | "archived";

export type BoxStatus = "online" | "offline";

export type DeviceState = "running" | "stopped" | "creating" | "removed";

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  account_id: string | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  name: string;
  status: AccountStatus;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountWithUsers extends Account {
  profiles: UserProfile[];
  user_count: number;
}

// ---------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------

export interface Box {
  id: string;
  tunnel_hostname: string;
  name: string | null;
  lan_ip: string | null;
  status: BoxStatus;
  uptime_seconds: number | null;
  container_count: number;
  last_heartbeat: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface BoxWithRelations extends Box {
  accounts: Account[];
  device_count: number;
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
