-- Host facts and the per-box maintenance window (25 September 2026 boxes session).
-- Additive only. Written by ONE code path — src/lib/boxes/presence.ts — from what
-- the box reports live (/healthz, /v1/get_hardware_cfg, /v1/systeminfo,
-- /v1/net_info, list_names + get_android_detail). Read by the slot arbiter
-- (src/lib/engine/box-slots.ts), the reconcile/reaper workers and both cockpits.
-- Applied through the Supabase MCP on 2026-09-25 as version 20260925211052.

alter table public.boxes
  add column if not exists model text,
  add column if not exists cbs_version text,
  add column if not exists kernel_version text,
  add column if not exists default_image text,
  add column if not exists host_health jsonb,
  add column if not exists firmware_checked_at timestamptz,
  add column if not exists maintenance_until timestamptz;

comment on column public.boxes.model is 'Hardware model reported by GET /v1/get_hardware_cfg (L1 for box-1..4; box-5 says E1.01 although it is K1 hardware). Vendor firmware targets are per model.';
comment on column public.boxes.cbs_version is 'cbs_go version from GET /v1/get_hardware_cfg → data.version (the only reliable source on the 1.1.4.x line).';
comment on column public.boxes.kernel_version is 'Host kernel build from GET /v1/get_hardware_cfg → data.kernel_version, e.g. 2.0.30_marsbox.';
comment on column public.boxes.default_image is 'Android image of the first container (repository name without tag), the box''s representative image.';
comment on column public.boxes.host_health is 'Last host sample: { cpu_percent, mem_percent, swap_percent, mmc_percent, ssd_percent, running, starting, sampled_at } from /v1/systeminfo + list_names. The slot arbiter refuses box_unhealthy above runtime_settings boxes.health_thresholds.';
comment on column public.boxes.firmware_checked_at is 'When model/cbs_version/kernel_version/default_image were last read from the box.';
comment on column public.boxes.maintenance_until is 'Per-box maintenance window: while now() < maintenance_until the arbiter refuses box_maintenance to automation, the reconcile does not flip status, the reaper leaves the box alone and the operator start route refuses. NULL or past = normal service.';
comment on column public.boxes.lan_ip is 'OBSERVED from GET /v1/net_info → host_ip (or /healthz lan_ip) by the presence writer. Never typed by hand: the boxes are on DHCP and move between offices.';

-- Thresholds the slot arbiter applies to host_health before a cold start.
-- cpu/mem/swap in percent, settling window in seconds after a box (re)start.
insert into public.runtime_settings (key, value)
values ('boxes.health_thresholds', '{"cpu_percent": 90, "mem_percent": 92, "swap_percent": 60, "settling_seconds": 600, "settling_max_starting": 2}'::jsonb)
on conflict (key) do nothing;
