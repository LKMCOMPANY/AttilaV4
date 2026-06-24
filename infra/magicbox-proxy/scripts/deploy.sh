#!/usr/bin/env bash
#
# Deploy magicbox-proxy to one or more boxes and restart the service.
#
# Usage:
#   ./scripts/deploy.sh ssh-box-1.attila.army ssh-box-3.attila.army
#
# Requires SSH access to each box (see README — typically a ~/.ssh/config
# Host block with a `cloudflared access ssh` ProxyCommand). Only src/ and
# package.json are synced; node_modules stays on the box (deps unchanged).
#
set -euo pipefail

HOSTS=("$@")
if [ ${#HOSTS[@]} -eq 0 ]; then
  echo "usage: $0 <ssh-host> [<ssh-host>...]" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_DIR="/opt/magicbox-proxy"

for H in "${HOSTS[@]}"; do
  echo "==> $H : syncing"
  ssh "$H" "mkdir -p ${REMOTE_DIR}/src"
  scp -q "$ROOT/package.json" "$H:${REMOTE_DIR}/package.json"
  scp -q "$ROOT"/src/*.js "$H:${REMOTE_DIR}/src/"

  echo "==> $H : installing deps + restarting"
  ssh "$H" "cd ${REMOTE_DIR} && (npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || true) && systemctl restart magicbox-proxy && sleep 1 && systemctl is-active magicbox-proxy"

  echo "==> $H : healthz"
  ssh "$H" "curl -s -m5 http://127.0.0.1:8080/healthz || echo 'healthz failed'"
  echo "==> $H : done"
  echo
done
