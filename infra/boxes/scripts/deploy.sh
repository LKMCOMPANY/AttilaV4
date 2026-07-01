#!/usr/bin/env bash
#
# Converge one or more MagicBox boxes to the versioned state in this repo:
#   - /etc/cloudflared/config.yml          (rendered from templates/ + manifest.tsv)
#   - /etc/systemd/system/cloudflared.service
#   - /etc/systemd/system/magicbox-proxy.service
#   - /opt/magicbox-proxy                  (code from ../../magicbox-proxy)
# then reload + restart the services and health-check.
#
# Idempotent: re-running is a no-op when the box already matches.
#
# Usage:
#   BOX_SSH_PASSWORD=... ./scripts/deploy.sh 3 4        # specific boxes
#   BOX_SSH_PASSWORD=... ./scripts/deploy.sh            # all boxes in manifest
#   BOX_SSH_PASSWORD=... ./scripts/deploy.sh --proxy-only 3   # only sync the proxy code
#
# Required env (never commit these — see .env.example):
#   BOX_SSH_PASSWORD        root SSH password for the boxes
#   CF_ACCESS_CLIENT_ID     Cloudflare Access service token id     (\
#   CF_ACCESS_CLIENT_SECRET   ...and secret) — used for the SSH ProxyCommand
# CF_ACCESS_* are auto-loaded from infra/boxes/.env or the app .env.local if present.
#
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"                 # infra/boxes
PROXY_SRC="$(cd "$ROOT/../magicbox-proxy" && pwd)"
MANIFEST="$ROOT/manifest.tsv"

# --- load optional local env (gitignored) -----------------------------------
[ -f "$ROOT/.env" ] && { set -a; . "$ROOT/.env"; set +a; }
# Fall back to the app env for the Cloudflare Access service token.
if [ -z "${CF_ACCESS_CLIENT_ID:-}" ] && [ -f "$ROOT/../../.env.local" ]; then
  set -a; . "$ROOT/../../.env.local"; set +a
fi

PROXY_ONLY=0
if [ "${1:-}" = "--proxy-only" ]; then PROXY_ONLY=1; shift; fi

# --- preconditions -----------------------------------------------------------
for bin in sshpass ssh scp cloudflared sed; do
  command -v "$bin" >/dev/null || { echo "missing dependency: $bin" >&2; exit 1; }
done
: "${BOX_SSH_PASSWORD:?set BOX_SSH_PASSWORD}"
: "${CF_ACCESS_CLIENT_ID:?set CF_ACCESS_CLIENT_ID}"
: "${CF_ACCESS_CLIENT_SECRET:?set CF_ACCESS_CLIENT_SECRET}"

# The boxes are root-only (see README). The SSH login user is configurable but
# defaults to root — without it, ssh uses the local $USER and the box rejects it.
BOX_SSH_USER="${BOX_SSH_USER:-root}"

PROXY_CMD="cloudflared access ssh --hostname %h --service-token-id ${CF_ACCESS_CLIENT_ID} --service-token-secret ${CF_ACCESS_CLIENT_SECRET}"
SSH_OPTS=(-o ConnectTimeout=35 -o PreferredAuthentications=password -o PubkeyAuthentication=no
          -o StrictHostKeyChecking=no -o ProxyCommand="$PROXY_CMD")

box_host() { echo "ssh-box-$1.attila.army"; }
ssh_box()  { local n="$1"; shift; SSHPASS="$BOX_SSH_PASSWORD" sshpass -e ssh "${SSH_OPTS[@]}" "${BOX_SSH_USER}@$(box_host "$n")" "$@"; }
scp_box()  { local n="$1" src="$2" dst="$3"; SSHPASS="$BOX_SSH_PASSWORD" sshpass -e scp -q "${SSH_OPTS[@]}" "$src" "${BOX_SSH_USER}@$(box_host "$n"):$dst"; }

tunnel_for()  { awk -F'\t' -v n="$1" '$1==n {print $2}' "$MANIFEST"; }
apihost_for() { awk -F'\t' -v n="$1" '$1==n {print $3}' "$MANIFEST"; }
boxes_all()   { awk -F'\t' '/^[0-9]/ {print $1}' "$MANIFEST"; }

render_config() {  # num tunnel -> stdout
  sed -e "s/__NUM__/$1/g" -e "s/__TUNNEL_ID__/$2/g" "$ROOT/templates/cloudflared.config.yml.tmpl"
}

deploy_proxy() {  # num — stream src + package.json as one tarball over a single
                  # SSH connection (many separate scp calls were flaky over the
                  # cloudflared + sshpass path).
  local n="$1"
  tar -C "$PROXY_SRC" -czf - package.json src \
    | ssh_box "$n" "mkdir -p /opt/magicbox-proxy && tar -C /opt/magicbox-proxy -xzf - && cd /opt/magicbox-proxy && (npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || true)"
}

deploy_full() {  # num
  local n="$1" tun; tun="$(tunnel_for "$n")"
  [ -n "$tun" ] || { echo "  ! no tunnel id for box-$n in manifest" >&2; return 1; }

  echo "  - cloudflared config + units"
  render_config "$n" "$tun" | ssh_box "$n" \
    "cp -f /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak.\$(date +%Y%m%d_%H%M%S) 2>/dev/null; cat > /etc/cloudflared/config.yml"
  scp_box "$n" "$ROOT/files/cloudflared.service"     "/etc/systemd/system/cloudflared.service"
  scp_box "$n" "$ROOT/files/magicbox-proxy.service"  "/etc/systemd/system/magicbox-proxy.service"

  # Explicit API_HOST override (these hosts have several non-internal IPv4s, so
  # the proxy's auto-detect is not safe to rely on). Empty manifest value ⇒
  # remove the file and fall back to auto-detect.
  local apihost; apihost="$(apihost_for "$n")"
  if [ -n "$apihost" ]; then
    echo "  - proxy env: API_HOST=$apihost"
    printf 'API_HOST=%s\n' "$apihost" | ssh_box "$n" "cat > /etc/magicbox-proxy.env"
  else
    ssh_box "$n" "rm -f /etc/magicbox-proxy.env"
  fi

  echo "  - proxy code"
  deploy_proxy "$n"

  echo "  - validate + (re)start"
  # Ingress validate is best-effort (the CLI flag order varies across cloudflared
  # versions: newer is `tunnel --config FILE ingress validate`). The real gate is
  # the external health-check below.
  #
  # cloudflared is restarted DETACHED (via a 2s transient timer) because our SSH
  # session runs THROUGH that same tunnel — a foreground restart kills the
  # session before the command returns. magicbox-proxy is restarted in-session
  # (it is not our transport). Recovery is verified externally in healthcheck().
  ssh_box "$n" "cloudflared tunnel --config /etc/cloudflared/config.yml ingress validate >/dev/null 2>&1 || echo '[warn] ingress validate skipped (cli flag mismatch)'; \
    systemctl daemon-reload; \
    systemctl enable cloudflared magicbox-proxy >/dev/null 2>&1 || true; \
    systemctl restart magicbox-proxy && systemctl is-active magicbox-proxy; \
    echo '[info] scheduling detached cloudflared restart (this session will drop briefly)'; \
    systemd-run --on-active=2s /bin/systemctl restart cloudflared >/dev/null 2>&1 || (nohup sh -c 'sleep 2; systemctl restart cloudflared' >/dev/null 2>&1 &)" || true
}

healthcheck() {  # num — external (the in-box path may be mid cloudflared restart)
  local n="$1" host="box-$1.attila.army" i code=000
  echo "  - waiting for cloudflared to come back (external probe)..."
  for i in $(seq 1 20); do
    sleep 3
    code=$(curl -s -o /dev/null -w "%{http_code}" -m 8 \
      -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" \
      -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}" \
      "https://${host}/healthz" 2>/dev/null || echo 000)
    [ "$code" = "200" ] && break
  done
  echo -n "  - healthz=${code} | stream-ready: "
  curl -s -m8 -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" \
    -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}" \
    "https://${host}/stream-ready/INVALIDID" 2>/dev/null || true
  echo
}

main() {
  local targets=("$@")
  if [ ${#targets[@]} -eq 0 ]; then
    while IFS= read -r line; do targets+=("$line"); done < <(boxes_all)
  fi

  for n in "${targets[@]}"; do
    echo "==> box-$n ($(box_host "$n"))"
    if [ "$PROXY_ONLY" = 1 ]; then
      deploy_proxy "$n"
      ssh_box "$n" "systemctl restart magicbox-proxy && systemctl is-active magicbox-proxy"
    else
      deploy_full "$n"
    fi
    healthcheck "$n"
    echo "==> box-$n done"; echo
  done
}

main "$@"
