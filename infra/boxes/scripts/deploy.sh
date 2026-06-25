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

PROXY_CMD="cloudflared access ssh --hostname %h --service-token-id ${CF_ACCESS_CLIENT_ID} --service-token-secret ${CF_ACCESS_CLIENT_SECRET}"
SSH_OPTS=(-o ConnectTimeout=35 -o PreferredAuthentications=password -o PubkeyAuthentication=no
          -o StrictHostKeyChecking=no -o ProxyCommand="$PROXY_CMD")

box_host() { echo "ssh-box-$1.attila.army"; }
ssh_box()  { local n="$1"; shift; SSHPASS="$BOX_SSH_PASSWORD" sshpass -e ssh "${SSH_OPTS[@]}" "$(box_host "$n")" "$@"; }
scp_box()  { local n="$1" src="$2" dst="$3"; SSHPASS="$BOX_SSH_PASSWORD" sshpass -e scp -q "${SSH_OPTS[@]}" "$src" "$(box_host "$n"):$dst"; }

tunnel_for()  { awk -F'\t' -v n="$1" '$1==n {print $2}' "$MANIFEST"; }
apihost_for() { awk -F'\t' -v n="$1" '$1==n {print $3}' "$MANIFEST"; }
boxes_all()   { awk -F'\t' '/^[0-9]/ {print $1}' "$MANIFEST"; }

render_config() {  # num tunnel -> stdout
  sed -e "s/__NUM__/$1/g" -e "s/__TUNNEL_ID__/$2/g" "$ROOT/templates/cloudflared.config.yml.tmpl"
}

deploy_proxy() {  # num
  local n="$1"
  ssh_box "$n" "mkdir -p /opt/magicbox-proxy/src"
  scp_box "$n" "$PROXY_SRC/package.json" "/opt/magicbox-proxy/package.json"
  local f; for f in "$PROXY_SRC"/src/*.js; do scp_box "$n" "$f" "/opt/magicbox-proxy/src/"; done
  ssh_box "$n" "cd /opt/magicbox-proxy && (npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || true)"
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
  ssh_box "$n" "cloudflared tunnel ingress validate --config /etc/cloudflared/config.yml >/dev/null \
    && systemctl daemon-reload \
    && systemctl enable --now cloudflared magicbox-proxy >/dev/null 2>&1 || true \
    && systemctl restart cloudflared && sleep 2 && systemctl restart magicbox-proxy && sleep 1 \
    && systemctl is-active cloudflared magicbox-proxy"
}

healthcheck() {  # num
  local n="$1"
  echo -n "  - healthz: "; ssh_box "$n" "curl -s -m5 http://127.0.0.1:8080/healthz" || true; echo
  echo -n "  - stream-ready route: "; ssh_box "$n" "curl -s -m5 http://127.0.0.1:8080/stream-ready/INVALIDID" || true; echo
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
