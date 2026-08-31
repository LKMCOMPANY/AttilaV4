# Fleet alignment & gated live actions

Canonical list of fleet-alignment findings and the **gated** live actions to
resolve them. "Gated" = touches a live box or the Cloudflare control plane, so
it is executed only on explicit approval, never as a side effect of a deploy.

`box-3` is out of service (tunnel down, `boxes.status=offline`) and is
**excluded** from every action below until it comes back.

Run the read-only checker any time to regenerate the live picture:

```bash
CLOUDFLARE_API_TOKEN=… node infra/boxes/scripts/check-drift.mjs
```

## 1. Naming inconsistencies (cosmetic, low risk)

These do not affect routing (DNS + ingress are correct and iso) but break the
"everything is `box-N`" mental model and make automation/greps brittle.

- **Tunnel name**: box-1's Cloudflare tunnel is named `magicbox`; boxes 2/4/5
  are `box-N`. Cloudflare tunnels can be renamed without re-issuing credentials
  (the tunnel **id** — used by DNS + `manifest.tsv` — is unchanged), so this is
  a safe rename. Gated: rename `magicbox` → `box-1` in the Cloudflare dashboard/API.
- **DB display name**: `boxes.name` is `"Box 1"` for box-1 but
  `"box-N.attila.army"` for the others. Gated (DB): normalize to a single
  convention (recommend the bare hostname `box-1.attila.army`, matching 2/4/5).
- **Legacy DNS record**: `ssh.attila.army` is a proxied CNAME to box-1's tunnel
  (`676c636f-….cfargotunnel.com`) — a pre-`ssh-box-N` leftover. Confirm nothing
  depends on it, then gated: delete the `ssh.attila.army` record.

## 2. Remote-managed tunnel config (second source of truth)

Every tunnel (1/2/4/5) carries a **remote** (dashboard/API) ingress config
(`configurations` version ≥1; box-1 is at v6). Because `cloudflared` runs with
`--config /etc/cloudflared/config.yml`, the **local** versioned file wins and
the remote config is inert — but it is a competing source of truth that can
mislead future edits.

Gated (Cloudflare API): delete the remote configuration for each tunnel so the
box's local `config.yml` (rendered from `templates/cloudflared.config.yml.tmpl`)
is unambiguously the only source. Read-only detection is already in
`check-drift.mjs` (`remote-cfg` line + `[gated] remote tunnel cfg` summary).

## 3. Version pins (repo = target)

Golden targets are pinned in [`fleet-reference.json`](fleet-reference.json):

- `android_image.golden` = `vcloud_android13_edge_20260626203150` (model-independent)
- `vendor_by_model.L1`    = cbs `1.1.6.12.1`, kernel `2.0.30_marsbox`
- `vendor_by_model.E1.01` = cbs `1.1.6.29.1`, kernel `2.0.57_k1`
- `cloudflared_version`  = `2026.6.1`
- `magicbox-proxy`       = read live from `infra/magicbox-proxy/package.json` (v1.1.0)

> **Corrected 2026-08-31.** This file previously pinned a single global vendor
> target taken from box-5, and the checker reported "1/5 on golden kernel". That
> was wrong: box-5 is an **E1.01** host while box-1..4 are **L1**, and the two
> families do not share a kernel. Read against per-model baselines, the fleet is
> **4/5 on kernel** — only box-1 is genuinely behind, on `1.0.86_marsbox` against
> the L1 target `2.0.30_marsbox`. The L1 CBS target is a composite: box-1 leads on
> CBS (`1.1.6.12.1`) while box-2/3/4 lead on kernel, so no single L1 box is on
> target yet.

Live drift today (see checker): **box-5** matches its model's vendor baseline and
the golden image. On the L1 side, box-2/3/4 are behind on CBS (`1.1.4.30.1`, the
140 MB binary line, against box-1's 201 MB `1.1.6.x`) and box-1 is behind on
kernel. The old claim that box-2/4 "run a CBS so old it does not even expose
`cbs_version`" was a probe bug, not a box limitation: `/v1/get_hardware_cfg`
reports the version on every box.

- **proxy code** (`magicbox-proxy`): uniform `1.1.0` fleet-wide — already iso,
  shipped by `deploy.sh`.
- **cloudflared binary**: boxes 1/2/4 on `2026.3.0`, box-5 on `2026.6.1`.
  `deploy.sh` installs `cloudflared` but does not pin its version; converging it
  is a gated live action (apt/binary upgrade + `systemctl restart cloudflared`).
- **vendor (image/cbs/kernel)**: converge-forward — see W4 in the plan; no mass
  re-image now.

### Per-box alignment snapshot (2026-07-07, post-convergence)

- **box-1**: image `…20260307170335` ✗ · CBS `1.1.6.12.1` ✗ · kernel `1.0.86_marsbox` ✗ · cloudflared `2026.6.1` ✅ · proxy `1.1.0` ✅ · cap 10 ✅
- **box-2**: image `…20260417164945` ✗ · CBS/kernel not exposed (old CBS) ✗ · cloudflared `2026.6.1` ✅ · proxy `1.1.0` ✅ · cap 10 ✅
- **box-4**: image `…20260511192039` ✗ · CBS/kernel not exposed (old CBS) ✗ · cloudflared `2026.6.1` ✅ · proxy `1.1.0` ✅ · cap 10 ✅
- **box-5**: image `…20260626203150` ✅ · CBS `1.1.6.29.1` ✅ · kernel `2.0.57_k1` ✅ · cloudflared `2026.6.1` ✅ · proxy `1.1.0` ✅ · cap 10 (reference)

Everything we ship or control is now **iso across the fleet**: cloudflared
`2026.6.1`, magicbox-proxy `1.1.0`, config/units, DNS, capacity 10. The only
remaining divergence is the **vendor firmware** (CBS/kernel/Android image) on
boxes 1/2/4 — handled converge-forward (new devices born golden) with a staged
re-image scheduled separately.

## 6. New-device provisioning contract (born-aligned)

The single source of truth for the target image is
[`fleet-reference.json`](fleet-reference.json) → `provisioning.golden_image`
(`vcloud_android13_edge_20260626203150`), which also meets the Android Control
API v2 minimums in `minimums`.

`MagicBox-Industrial` provisioning accepts `--image-repository`; if omitted, VMOS
falls back to an ancient built-in image (drift). So **new devices must be created
with `--image-repository <golden_image>`** (read the value from
`fleet-reference.json`, do not re-hardcode it in the provisioning repo — that
would create a second source of truth). This keeps every newly-created device on
the golden image without a cross-repo copy of the version string. The
creation-time Oxylabs IP/blacklist check (`checkProxyIp`) stays the gate before
hand-off.

## 4. Capacity policy (decision needed)

`max_concurrent_containers` = 10 on box-5, 3 on boxes 1/2/4. This is a
per-hardware decision, so the checker reports it as informational, not a
failure. Decide a fleet policy (per-hardware documented values, or standardize)
and record it; box hardware differs, so "same everywhere" may be wrong.

## 5. Data hygiene (DB, gated)

- `box-3` (offline) still has 7 devices with `state='running'` in the DB that
  were never reconciled when the box went offline. The offline-reconcile added
  in W5 (`markBoxOffline` in the reaper + `syncBox` catch) fixes this going
  forward. A one-shot cleanup for box-3 now (gated):
  `update devices set state='stopped', last_seen=now() where box_id in (select id from boxes where status='offline') and state='running';`

---

# Gated live-mutation checklist

Status legend: ✅ done (2026-07-07) · ⏸ blocked (needs a credential/console I
don't have) · ↩ intentionally skipped.

## A. Cloudflare control plane

1. ✅ **Renamed tunnel `magicbox` → `box-1`** via CF API (tunnel id unchanged, so
   DNS + `manifest.tsv` keep working). All five tunnels now `box-N`.
2. ↩ **Remote-managed tunnel configs** left as-is. `cloudflared` runs with
   `--config /etc/cloudflared/config.yml`, so the local file is authoritative and
   the remote config is inert. Cloudflare exposes no clean DELETE for a tunnel
   configuration (only PUT), so removing it would mean writing an empty/placeholder
   config — a riskier hack than leaving an ignored fallback. `check-drift` keeps
   surfacing it for visibility.
3. ✅ **Deleted legacy DNS record `ssh.attila.army`** (nothing referenced it;
   `ssh-box-N` is the supported form). Verified 0 remaining.

## B. Box convergence (`deploy.sh`, SSH-through-Access) — ✅ done (2026-07-07)

4. ✅ **Re-converged cloudflared config + magicbox-proxy + units** on boxes
   1/2/4/5 via `./scripts/deploy.sh 1 2 4 5`. All health-checked 200 after the
   detached cloudflared restart. proxy stays iso at 1.1.0.
5. ✅ **Upgraded cloudflared `2026.3.0` → `2026.6.1`** on boxes 1/2/4 (box-5 was
   already there). Method: pinned arm64 `.deb` (Debian 11, aarch64) scp'd to the
   box, then a **detached** `dpkg -i` + `systemctl restart cloudflared` (so the
   restart doesn't kill the SSH-through-tunnel session), canary on box-2 first,
   each verified via external `/healthz` + CF-API version. `check-drift` now
   reports cloudflared **4/4 on golden**. Temp files cleaned up.

## C. Vendor convergence (converge-forward; NOT a mass re-image now)

6. ✅ **New devices/boxes**: provisioning contract documented — create with
   `--image-repository <golden_image>` from `fleet-reference.json`. No action on
   existing devices.
7. ⏸ **Optional, staged**: upgrade box-1/2/4 vendor (CBS/kernel/image) toward
   golden via vendor propagation from the reference box. High-impact, per-box,
   scheduled separately.

## D. Proxy fleet (per the strategy)

8. ✅ **End-to-end proxy path validated live** + ✅ **full fleet proxy audit**.
   `scripts/audit-proxy-fleet.mjs` walked every device on the online boxes
   (start → `proxy_get` → write DB truth → stop), repairing the DB mirror that
   only ever learned proxies on running devices. Result (2026-07-07, active
   devices, ghosts excluded):
   - box-1: **92/96 proxied (96%)**  · box-2: **56/57 (98%)**  · box-4: **66/67 (99%)**  · box-5: **100/100 (100%)**
   - Fleet ≈ **314/320 ≈ 98%** — the earlier "5–40%" was a DB-visibility artifact.
   - **47 ghost rows** (DB devices whose `db_id` no longer exists on the box, mostly
     box-5 `US112–US151`) marked `removed` via `scripts/reconcile-devices.mjs`.
   - Genuinely **without a proxy (3)**: `box-1/US42`, `box-4/US56`,
     `box-2/parked_probe_box2_b` (a parked test device).
   - **Unreadable (3)**: `box-1/FR4,US2,US8` — boot_timeout (>120 s). box-1 runs
     the oldest CBS/kernel; slow/stuck boot is a box-1 firmware-health signal,
     tie it to the vendor convergence.
   - Note: box-4 has **73 live containers vs 67 in DB** → ~6 devices created on
     the box but not yet imported into Attila; run admin **Sync** on box-4.
   Tools added: `scripts/audit-proxy-fleet.mjs` (`--dry-run`, `--box`, `--limit`,
   `--only-unproxied`) and `scripts/reconcile-devices.mjs`.
9. ⏸ **Standardize proxy mode to `vpn`** + consider `udpDisabled: true` for the
   creation profile — validate on box-5 first (see `PROXY-STRATEGY.md`). Applied
   at creation in `MagicBox-Industrial`, not from Attila.

## E. Capacity policy — ✅ done

10. ✅ **Standardized `max_concurrent_containers = 10` fleet-wide** (was box-5=10,
    others=3). Data-backed: box-1 has 32GB RAM, box-2/4 have 16GB like box-5 which
    already runs 10; 10 is the VMOS host ceiling (AGENTS.md). `operator_reserve`
    stays 1. Policy recorded in `fleet-reference.json`.

## F. Database security hardening (advisors)

11. ✅ **Locked service-only functions** (migration `20260707140000`): revoked
    `anon` + `authenticated` EXECUTE on `claim_pending_job`, `claim_pending_post`,
    `enqueue_gorgone_job`, `register_gorgone_event`,
    `list_gorgone_zone_cursors_for_link`, `increment_campaign_counter` (all called
    only via the service-role admin client). `get_device_counts_by_box` locked
    from `anon` earlier (`20260707130000`). Left executable: `is_admin` (RLS) and
    `handle_new_user` (trigger).
12. ⏸ **Enable leaked-password protection** — Supabase Auth setting (Dashboard →
    Authentication → Passwords → "Leaked password protection"). No management-API
    tool available here; one-click toggle for you.
