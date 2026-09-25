#!/usr/bin/env bash
# Shared by deploy.sh and the other fleet scripts: env loading, manifest
# lookups, LAN-first box discovery and the ssh/scp wrappers.
#
# Transport policy ("LAN first, tunnel as fallback", decided 25 Sep 2026):
#   1. The box is looked for on the CURRENT LAN by its MAC (ARP table, then a
#      quick :18182 sweep of the local /24 to populate it) and confirmed by
#      `GET /v1/get_hardware_cfg → device_id` before it is trusted.
#   2. Otherwise SSH rides the Cloudflare tunnel (`ssh-box-N.attila.army`
#      through `cloudflared access ssh`), exactly as before.
# Authentication: the fleet key (~/.ssh/id_ed25519_attila or $BOX_SSH_KEY) is
# tried first; the root password ($BOX_SSH_PASSWORD, via sshpass) is the
# bootstrap fallback for a box that has not received the key yet.
#
# Source this file; it defines functions and the ROOT/MANIFEST variables.

set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$LIB_DIR/../.." && pwd)"                 # infra/boxes
APP_ROOT="$(cd "$ROOT/../.." && pwd)"                 # Attila V4/
MANIFEST="$ROOT/manifest.tsv"
REFERENCE="$ROOT/fleet-reference.json"

# --- env: infra/boxes/.env wins, the app .env.local fills the gaps ------------
[ -f "$ROOT/.env" ] && { set -a; . "$ROOT/.env"; set +a; }
if [ -z "${CF_ACCESS_CLIENT_ID:-}" ] && [ -f "$APP_ROOT/.env.local" ]; then
  set -a; . "$APP_ROOT/.env.local"; set +a
fi

BOX_SSH_USER="${BOX_SSH_USER:-root}"
BOX_SSH_KEY="${BOX_SSH_KEY:-$HOME/.ssh/id_ed25519_attila}"
LAN_SWEEP="${LAN_SWEEP:-1}"          # 0 → ARP cache only, no /24 sweep
FORCE_TUNNEL="${FORCE_TUNNEL:-0}"    # 1 → never use the LAN

# --- manifest ------------------------------------------------------------------
manifest_field() {  # num col
  awk -F'\t' -v n="$1" -v c="$2" '$1==n {print $c}' "$MANIFEST"
}
tunnel_for()    { manifest_field "$1" 2; }
device_id_for() { manifest_field "$1" 3; }
hwaddr_for()    { manifest_field "$1" 4 | tr 'A-F' 'a-f'; }
boxes_all()     { awk -F'\t' '/^[0-9]/ {print $1}' "$MANIFEST"; }

# --- reference pins (fleet-reference.json) -------------------------------------
ref() {  # jq path, e.g. '.runtime.node.version'
  jq -r "$1" "$REFERENCE"
}

# --- LAN discovery ---------------------------------------------------------------

# IPv4 candidates whose ARP entry carries this MAC (macOS and Linux `arp -a`).
arp_ips_for_mac() {  # mac(lower) → ips
  arp -a 2>/dev/null | tr 'A-F' 'a-f' | awk -v mac="$1" '
    { for (i=1;i<=NF;i++) if ($i==mac) { gsub(/[()]/,"",$2); print $2 } }'
}

# The /24 of the default interface (macOS + Linux). Empty when unknown.
local_slash24() {
  local ip
  ip=$(ipconfig getifaddr "$(route -n get default 2>/dev/null | awk '/interface:/ {print $2}')" 2>/dev/null || true)
  [ -n "$ip" ] || ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  [ -n "$ip" ] && echo "${ip%.*}"
}

# Sweep the local /24 for VMOS hosts (:18182 answers get_hardware_cfg) so the
# ARP table learns every box in ~2 s. Read-only.
lan_sweep() {
  local prefix; prefix="$(local_slash24)"
  [ -n "$prefix" ] || return 0
  seq 1 254 | xargs -P 64 -I{} sh -c \
    "curl -s -m 1 -o /dev/null http://$prefix.{}:18182/v1/heartbeat 2>/dev/null || true"
}

# Print the LAN IP of box N if it is here and proves its identity; else nothing.
discover_lan_ip() {  # num
  local n="$1" dev mac ip got
  dev="$(device_id_for "$n")"; mac="$(hwaddr_for "$n")"
  [ "$FORCE_TUNNEL" = 1 ] && return 0
  [ -n "$dev" ] && [ -n "$mac" ] || return 0
  local ips; ips="$(arp_ips_for_mac "$mac")"
  if [ -z "$ips" ] && [ "$LAN_SWEEP" = 1 ]; then lan_sweep; ips="$(arp_ips_for_mac "$mac")"; fi
  for ip in $ips; do
    got=$(curl -s -m 3 "http://$ip:18182/v1/get_hardware_cfg" | jq -r '.data.device_id // empty' 2>/dev/null || true)
    if [ "$got" = "$dev" ]; then echo "$ip"; return 0; fi
  done
  return 0
}

# --- ssh / scp ---------------------------------------------------------------------

BOX_TRANSPORT=""   # "lan" | "tunnel" after resolve_transport
BOX_TARGET=""      # ip or ssh-box-N host
BOX_AUTH=""        # "key" | "password"

_ssh_common=(-o ConnectTimeout=20 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)

_proxy_cmd() {
  echo "cloudflared access ssh --hostname %h --service-token-id ${CF_ACCESS_CLIENT_ID} --service-token-secret ${CF_ACCESS_CLIENT_SECRET}"
}

# Decide transport + auth for box N once; later ssh_box/scp_box reuse it.
resolve_transport() {  # num
  local n="$1" ip
  ip="$(discover_lan_ip "$n")"
  if [ -n "$ip" ]; then BOX_TRANSPORT=lan; BOX_TARGET="$ip"
  else
    : "${CF_ACCESS_CLIENT_ID:?set CF_ACCESS_CLIENT_ID (tunnel transport)}"
    : "${CF_ACCESS_CLIENT_SECRET:?set CF_ACCESS_CLIENT_SECRET (tunnel transport)}"
    BOX_TRANSPORT=tunnel; BOX_TARGET="ssh-box-$n.attila.army"
  fi
  # Key first, password as bootstrap fallback. sshd on the boxes intermittently
  # refuses a password login right after another session (25 Sep 2026), so the
  # password path gets one spaced retry before the box is declared unreachable.
  if [ -f "$BOX_SSH_KEY" ] && _try_ssh key true 2>/dev/null; then BOX_AUTH=key
  elif [ -n "${BOX_SSH_PASSWORD:-}" ] && { _try_ssh password true 2>/dev/null || { sleep 4; _try_ssh password true 2>/dev/null; }; }; then BOX_AUTH=password
  else echo "  ! box-$n: neither key nor password login works over $BOX_TRANSPORT ($BOX_TARGET)" >&2; return 1
  fi
  echo "  - transport: $BOX_TRANSPORT ($BOX_TARGET), auth: $BOX_AUTH"
}

_ssh_opts() {  # auth
  local opts=("${_ssh_common[@]}")
  [ "$BOX_TRANSPORT" = tunnel ] && opts+=(-o ProxyCommand="$(_proxy_cmd)")
  if [ "$1" = key ]; then opts+=(-o PreferredAuthentications=publickey -o IdentitiesOnly=yes -i "$BOX_SSH_KEY")
  else opts+=(-o PreferredAuthentications=password -o PubkeyAuthentication=no); fi
  printf '%s\n' "${opts[@]}"
}

_try_ssh() {  # auth cmd...
  local auth="$1"; shift
  local opts=(); while IFS= read -r o; do opts+=("$o"); done < <(_ssh_opts "$auth")
  if [ "$auth" = key ]; then ssh -o BatchMode=yes "${opts[@]}" "${BOX_SSH_USER}@${BOX_TARGET}" "$@"
  else SSHPASS="$BOX_SSH_PASSWORD" sshpass -e ssh "${opts[@]}" "${BOX_SSH_USER}@${BOX_TARGET}" "$@"; fi
}

ssh_box() { _try_ssh "$BOX_AUTH" "$@"; }

scp_box() {  # src dst
  local opts=(); while IFS= read -r o; do opts+=("$o"); done < <(_ssh_opts "$BOX_AUTH")
  if [ "$BOX_AUTH" = key ]; then scp -q -o BatchMode=yes "${opts[@]}" "$1" "${BOX_SSH_USER}@${BOX_TARGET}:$2"
  else SSHPASS="$BOX_SSH_PASSWORD" sshpass -e scp -q "${opts[@]}" "$1" "${BOX_SSH_USER}@${BOX_TARGET}:$2"; fi
}

# External (tunnel) health probe of the proxy; prints the HTTP code.
tunnel_healthz() {  # num
  curl -s -o /dev/null -w "%{http_code}" -m 8 \
    -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID:-}" \
    -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET:-}" \
    "https://box-$1.attila.army/healthz" 2>/dev/null || echo 000
}
