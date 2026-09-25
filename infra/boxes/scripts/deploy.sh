#!/usr/bin/env bash
#
# Converge one or more MagicBox boxes to the versioned state in this repo:
#   - /etc/cloudflared/config.yml          (rendered from templates/ + manifest.tsv)
#   - systemd units, host hygiene files    (files/ — sysctl, journald, logrotate, DNS)
#   - hostname box-N, Europe/Paris, en_US.UTF-8, fleet SSH key
#   - Node 24 under /opt/node, cloudflared at the pinned version (fleet-reference.json)
#   - /opt/magicbox-proxy                  (code from ../../magicbox-proxy)
# then restart the services and health-check.
#
# Transport is LAN-first (box found by MAC + device_id on the current LAN),
# tunnel otherwise — see lib/transport.sh. No IP address is read from or
# written to any config: the proxy resolves cbs_go's address itself.
#
# Idempotent: re-running is a no-op when the box already matches.
#
# Usage:
#   ./scripts/deploy.sh 2                    # one box
#   ./scripts/deploy.sh                      # all boxes in the manifest
#   ./scripts/deploy.sh --proxy-only 3 4     # fast path: only the proxy code
#   ./scripts/deploy.sh --lock-root-password 2   # GATED: key-only root after a verified key login
#   FORCE_TUNNEL=1 ./scripts/deploy.sh 2     # ignore the LAN
#
# Env (never commit — see .env.example): BOX_SSH_PASSWORD (bootstrap only, once
# the key is installed it is unused), CF_ACCESS_CLIENT_ID/SECRET (tunnel
# transport + external health-check), BOX_SSH_KEY (default ~/.ssh/id_ed25519_attila).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/transport.sh"
PROXY_SRC="$(cd "$ROOT/../magicbox-proxy" && pwd)"

PROXY_ONLY=0; LOCK_ROOT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --proxy-only) PROXY_ONLY=1; shift;;
    --lock-root-password) LOCK_ROOT=1; shift;;
    --) shift; break;;
    -*) echo "unknown flag: $1" >&2; exit 2;;
    *) break;;
  esac
done

for bin in ssh scp curl tar jq; do
  command -v "$bin" >/dev/null || { echo "missing dependency: $bin" >&2; exit 1; }
done

render_config() {  # num tunnel -> stdout
  sed -e "s/__NUM__/$1/g" -e "s/__TUNNEL_ID__/$2/g" "$ROOT/templates/cloudflared.config.yml.tmpl"
}

# One tarball, one SSH connection: files/, the rendered cloudflared config, the
# proxy code, and the remote converge script. Unpacked in a per-run staging dir.
build_stage() {  # num → path of local tarball
  local n="$1" tun stage
  tun="$(tunnel_for "$n")"; [ -n "$tun" ] || { echo "  ! no tunnel id for box-$n in manifest" >&2; return 1; }
  stage="$(mktemp -d)"
  cp -R "$ROOT/files" "$stage/files"
  render_config "$n" "$tun" > "$stage/cloudflared.config.yml"
  COPYFILE_DISABLE=1 tar --no-xattrs -C "$PROXY_SRC" -czf "$stage/proxy.tgz" package.json src
  cp "$HERE/remote/converge-host.sh" "$stage/converge-host.sh"
  COPYFILE_DISABLE=1 tar --no-xattrs -C "$stage" -czf "$stage.tgz" .
  rm -rf "$stage"
  echo "$stage.tgz"
}

converge() {  # num
  local n="$1" tgz remote_stage
  tgz="$(build_stage "$n")"
  remote_stage="/root/.attila-deploy/$(date +%Y%m%d_%H%M%S)"
  echo "  - shipping stage ($(du -h "$tgz" | cut -f1)) → $remote_stage"
  ssh_box "mkdir -p '$remote_stage' && tar -C '$remote_stage' -xzf -" < "$tgz"
  rm -f "$tgz"

  local via_tunnel=0; [ "$BOX_TRANSPORT" = tunnel ] && via_tunnel=1
  local lock=0
  if [ "$LOCK_ROOT" = 1 ]; then
    if [ "$BOX_AUTH" = key ]; then lock=1
    else echo "  ! --lock-root-password refused: this run did not authenticate with the key" >&2; fi
  fi

  ssh_box "cd '$remote_stage' && env \
    BOX_NUM='$n' STAGE='$remote_stage' PROXY_ONLY='$PROXY_ONLY' VIA_TUNNEL='$via_tunnel' LOCK_ROOT_PASSWORD='$lock' \
    NODE_VERSION='$(ref .runtime.node.version)' NODE_URL='$(ref .runtime.node.url)' NODE_SHA256='$(ref .runtime.node.sha256)' \
    NODE_PREFIX='$(ref .runtime.node.install_prefix)' NODE_SYMLINK='$(ref .runtime.node.symlink)' \
    CF_VERSION='$(ref .runtime.cloudflared.version)' CF_URL='$(ref .runtime.cloudflared.url)' CF_SHA256='$(ref .runtime.cloudflared.sha256)' \
    TZ_TARGET='$(ref .host_hygiene.timezone)' LOCALE_TARGET='$(ref .host_hygiene.locale)' \
    bash converge-host.sh && rm -rf '$remote_stage'"
}

healthcheck() {  # num
  local n="$1" i code=000
  echo -n "  - external /healthz:"
  for i in $(seq 1 20); do
    code="$(tunnel_healthz "$n")"
    [ "$code" = "200" ] && break
    sleep 3
  done
  echo " $code"
  if [ "$BOX_TRANSPORT" = lan ]; then
    echo -n "  - LAN /v1/heartbeat: "; curl -s -m 5 "http://$BOX_TARGET:18182/v1/heartbeat" | jq -c '.data' 2>/dev/null || echo "(no answer)"
  fi
  echo -n "  - proxy says: "
  curl -s -m 8 -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID:-}" -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET:-}" \
    "https://box-$n.attila.army/healthz" 2>/dev/null | jq -c '{version, api_host, api_source, containers, error}' 2>/dev/null || echo "(unreachable)"
}

main() {
  local targets=("$@")
  if [ ${#targets[@]} -eq 0 ]; then
    while IFS= read -r line; do targets+=("$line"); done < <(boxes_all)
  fi
  for n in "${targets[@]}"; do
    echo "==> box-$n"
    resolve_transport "$n" || { echo "==> box-$n SKIPPED (unreachable)"; echo; continue; }
    converge "$n"
    healthcheck "$n"
    echo "==> box-$n done"; echo
  done
}

main "$@"
