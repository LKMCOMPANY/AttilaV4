#!/usr/bin/env bash
# Runs ON THE BOX as root, piped by deploy.sh (`bash -s`) after the staging
# tarball has been unpacked in $STAGE. Converges the host to the versioned
# state and prints a one-line summary per step. Idempotent: a box already on
# target changes nothing and restarts nothing but magicbox-proxy.
#
# Inputs (env): BOX_NUM STAGE PROXY_ONLY VIA_TUNNEL LOCK_ROOT_PASSWORD
#   NODE_VERSION NODE_URL NODE_SHA256 NODE_PREFIX NODE_SYMLINK
#   CF_VERSION CF_URL CF_SHA256 TZ_TARGET LOCALE_TARGET
set -euo pipefail

# Progress goes to stderr so that functions whose stdout is captured (`$(…)`)
# still report what they did.
say() { echo "  - $*" >&2; }
F="$STAGE/files"

# Install a versioned file if it differs; echo 1 when it changed.
put() {  # src dst [mode]
  local src="$1" dst="$2" mode="${3:-0644}"
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then return 0; fi
  install -D -m "$mode" "$src" "$dst"; echo 1
}

# ---------------------------------------------------------------------------
# 1. Proxy code (both paths) — Node 24 must exist before npm runs.
# ---------------------------------------------------------------------------
install_node() {
  local want="v$NODE_VERSION"
  if [ -x "$NODE_SYMLINK/bin/node" ] && [ "$("$NODE_SYMLINK/bin/node" --version)" = "$want" ]; then
    say "node $want already installed"; return 0
  fi
  say "installing node $want → $NODE_PREFIX"
  local tar="$STAGE/node.tar.xz"
  if curl -fsSL --retry 3 -m 600 -o "$tar" "$NODE_URL" \
     && echo "$NODE_SHA256  $tar" | sha256sum -c - >/dev/null \
     && mkdir -p /opt && tar -C /opt -xJf "$tar" \
     && [ "$("$NODE_PREFIX/bin/node" --version)" = "$want" ]; then
    ln -sfn "$NODE_PREFIX" "$NODE_SYMLINK"
    say "node $("$NODE_SYMLINK/bin/node" --version) ready"
    return 0
  fi
  # The unit now points at $NODE_SYMLINK/bin/node: a failed download must not
  # leave the proxy without a runtime. Degrade to the distro Node (v20, EOL);
  # check-drift reports the version so the gap is seen, not hidden.
  if [ ! -x "$NODE_SYMLINK/bin/node" ] && [ -x /usr/bin/node ]; then
    ln -sfn /usr "$NODE_SYMLINK"
    say "! node $want install failed — $NODE_SYMLINK → /usr (distro $(/usr/bin/node --version)) as a stopgap"
  else
    say "! node $want install failed — keeping $("$NODE_SYMLINK/bin/node" --version 2>/dev/null || echo none)"
  fi
}

install_proxy() {
  mkdir -p /opt/magicbox-proxy
  tar -C /opt/magicbox-proxy -xzf "$STAGE/proxy.tgz"
  (cd /opt/magicbox-proxy && PATH="$NODE_SYMLINK/bin:$PATH" npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1) \
    || say "! npm install failed (keeping existing node_modules)"
  say "proxy $(jq -r .version /opt/magicbox-proxy/package.json 2>/dev/null || sed -n 's/.*"version": "\(.*\)".*/\1/p' /opt/magicbox-proxy/package.json) code in place"
}

# ---------------------------------------------------------------------------
# 2. Files we manage (units, cloudflared config, hygiene). No IP anywhere.
# ---------------------------------------------------------------------------
install_files() {
  local changed=""
  if [ -f "$STAGE/cloudflared.config.yml" ] && ! cmp -s "$STAGE/cloudflared.config.yml" /etc/cloudflared/config.yml; then
    cp -f /etc/cloudflared/config.yml "/etc/cloudflared/config.yml.bak.$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
    install -D -m 0644 "$STAGE/cloudflared.config.yml" /etc/cloudflared/config.yml; changed="$changed cloudflared.yml"
  fi
  [ -n "$(put "$F/cloudflared.service" /etc/systemd/system/cloudflared.service)" ] && changed="$changed cloudflared.service"
  [ -n "$(put "$F/magicbox-proxy.service" /etc/systemd/system/magicbox-proxy.service)" ] && changed="$changed proxy.service"
  [ -n "$(put "$F/sysctl.d/90-attila.conf" /etc/sysctl.d/90-attila.conf)" ] && changed="$changed sysctl"
  [ -n "$(put "$F/attila-sysctl.service" /etc/systemd/system/attila-sysctl.service)" ] && changed="$changed sysctl.service"
  [ -n "$(put "$F/attila-sysctl.timer" /etc/systemd/system/attila-sysctl.timer)" ] && changed="$changed sysctl.timer"
  [ -n "$(put "$F/journald.conf.d/attila.conf" /etc/systemd/journald.conf.d/attila.conf)" ] && changed="$changed journald"
  [ -n "$(put "$F/logrotate.d/rsyslog" /etc/logrotate.d/rsyslog)" ] && changed="$changed logrotate.rsyslog"
  [ -n "$(put "$F/logrotate.d/attila-mihomo" /etc/logrotate.d/attila-mihomo)" ] && changed="$changed logrotate.mihomo"
  [ -n "$(put "$F/NetworkManager/conf.d/90-attila-dns.conf" /etc/NetworkManager/conf.d/90-attila-dns.conf)" ] && changed="$changed nm-dns"
  if [ -L /etc/resolv.conf ] || ! cmp -s "$F/resolv.conf" /etc/resolv.conf; then
    rm -f /etc/resolv.conf; install -m 0644 "$F/resolv.conf" /etc/resolv.conf; changed="$changed resolv.conf"
  fi
  # The pinned-IP override file is the box-4 footgun: never again. box-1 also
  # carried a pre-IaC systemd drop-in (April 2026) with Environment=API_HOST=…
  # that survived every deploy since: the unit's drop-in directory is not part
  # of this IaC, so anything in it is removed.
  if [ -f /etc/magicbox-proxy.env ]; then rm -f /etc/magicbox-proxy.env; changed="$changed -proxy.env"; fi
  if [ -d /etc/systemd/system/magicbox-proxy.service.d ]; then
    rm -rf /etc/systemd/system/magicbox-proxy.service.d; changed="$changed -proxy.service.d"
  fi
  # Dead unit from the April 2026 on-box webapp (disabled, nothing behind it).
  if [ -f /etc/systemd/system/attila-webapp.service ]; then
    systemctl disable attila-webapp.service >/dev/null 2>&1 || true
    rm -f /etc/systemd/system/attila-webapp.service; changed="$changed -attila-webapp.service"
  fi
  systemctl daemon-reload
  say "files:${changed:- (all current)}"
  echo "$changed"
}

apply_hygiene() {
  # sysctl (runtime + persisted); the vendor's zram-init asserts the same value
  # at boot, and attila-sysctl.timer re-asserts it every minute (privileged
  # Android guests write swappiness=100 through to a 5.10 host).
  sysctl -q -p /etc/sysctl.d/90-attila.conf || true
  systemctl enable --now attila-sysctl.timer >/dev/null 2>&1 || say "! attila-sysctl.timer could not be enabled"
  # journald: bound and vacuum now.
  systemctl restart systemd-journald 2>/dev/null || true
  journalctl --vacuum-size=300M >/dev/null 2>&1 || true
  # rsyslog/mihomo rotation needs the logrotate package (absent on the vendor image).
  if ! dpkg -s logrotate >/dev/null 2>&1; then
    say "installing logrotate"
    (apt-get update -qq >/dev/null 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq logrotate >/dev/null 2>&1) \
      || say "! apt-get install logrotate failed (mirror unreachable?) — rotation not active"
    # apt installs its own /etc/logrotate.d/rsyslog: ours replaces it.
    install -m 0644 "$F/logrotate.d/rsyslog" /etc/logrotate.d/rsyslog
    systemctl enable --now logrotate.timer >/dev/null 2>&1 || true
  fi
  apt-get clean >/dev/null 2>&1 || true
  # DNS: NetworkManager hands resolv.conf over (dns=none), ours is in place.
  systemctl reload NetworkManager 2>/dev/null || true
  # Identity: hostname box-N, Europe/Paris, en_US.UTF-8.
  local want="box-$BOX_NUM"
  if [ "$(hostnamectl --static 2>/dev/null || hostname)" != "$want" ]; then
    hostnamectl set-hostname "$want" 2>/dev/null || hostname "$want"
    # One 127.0.1.1 line (the vendor image carries two: linaro-alip + marsbox);
    # `marsbox` stays as an alias so nothing that resolves the old name breaks.
    sed -i -E '/^127\.0\.1\.1[[:space:]]/d' /etc/hosts
    printf '127.0.1.1\t%s marsbox\n' "$want" >> /etc/hosts
    say "hostname → $want"
  fi
  if [ "$(timedatectl show -p Timezone --value 2>/dev/null)" != "$TZ_TARGET" ]; then
    timedatectl set-timezone "$TZ_TARGET" && say "timezone → $TZ_TARGET"
  fi
  if ! locale -a 2>/dev/null | grep -qi "^${LOCALE_TARGET%.*}\.utf8$"; then
    sed -i -E "s/^# *(${LOCALE_TARGET} UTF-8)/\1/" /etc/locale.gen
    grep -q "^${LOCALE_TARGET} UTF-8" /etc/locale.gen || echo "${LOCALE_TARGET} UTF-8" >> /etc/locale.gen
    locale-gen >/dev/null 2>&1 && say "locale ${LOCALE_TARGET} generated"
  fi
  if [ "$(grep -c "^LANG=${LOCALE_TARGET}$" /etc/default/locale)" != 1 ] || [ "$(grep -c '^LANG=' /etc/default/locale)" != 1 ]; then
    printf 'LANG=%s\n' "$LOCALE_TARGET" > /etc/default/locale && say "LANG → $LOCALE_TARGET"
  fi
}

install_key() {
  local key; key="$(cat "$F/authorized_keys.d/attila-fleet.pub")"
  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  touch /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys
  if ! grep -qF "$(echo "$key" | awk '{print $2}')" /root/.ssh/authorized_keys; then
    echo "$key" >> /root/.ssh/authorized_keys; say "fleet key authorized"
  fi
}

lock_root_password() {
  [ "$LOCK_ROOT_PASSWORD" = 1 ] || return 0
  [ -n "$(put "$F/sshd_config.d/60-attila.conf" /etc/ssh/sshd_config.d/60-attila.conf)" ] || { say "root password already locked"; return 0; }
  if sshd -t; then systemctl reload ssh 2>/dev/null || systemctl reload sshd; say "root password authentication DISABLED (key only)"
  else rm -f /etc/ssh/sshd_config.d/60-attila.conf; say "! sshd -t rejected the drop-in, removed"; fi
}

# Prints 1 when the binary changed (the caller then restarts the tunnel).
install_cloudflared() {
  if cloudflared --version 2>/dev/null | grep -q "version $CF_VERSION "; then say "cloudflared $CF_VERSION already installed"; return 0; fi
  say "installing cloudflared $CF_VERSION"
  local deb="$STAGE/cloudflared.deb"
  if curl -fsSL --retry 3 -m 600 -o "$deb" "$CF_URL" \
     && echo "$CF_SHA256  $deb" | sha256sum -c - >/dev/null \
     && DEBIAN_FRONTEND=noninteractive dpkg -i "$deb" >/dev/null \
     && cloudflared --version | grep -q "version $CF_VERSION "; then
    # dpkg does not restart the running tunnel; restart_services() does.
    say "cloudflared $(cloudflared --version | awk '{print $3}') installed"
    echo 1
  else
    say "! cloudflared $CF_VERSION install failed — keeping $(cloudflared --version 2>/dev/null | awk '{print $3}')"
  fi
}

restart_services() {  # cloudflared_changed(0/1)
  systemctl enable cloudflared magicbox-proxy >/dev/null 2>&1 || true
  systemctl restart magicbox-proxy
  say "magicbox-proxy $(systemctl is-active magicbox-proxy)"
  if [ "$1" = 1 ]; then
    if [ "$VIA_TUNNEL" = 1 ]; then
      # Our SSH session rides this tunnel: restart it after we are gone.
      systemd-run --on-active=2s /bin/systemctl restart cloudflared >/dev/null 2>&1 \
        || (nohup sh -c 'sleep 2; systemctl restart cloudflared' >/dev/null 2>&1 &)
      say "cloudflared restart scheduled (detached — this session rides the tunnel)"
    else
      systemctl restart cloudflared; say "cloudflared $(systemctl is-active cloudflared)"
    fi
  fi
}

summary() {
  echo "  = summary: host=$(hostname) tz=$(timedatectl show -p Timezone --value 2>/dev/null) lang=$(sed -n 's/^LANG=//p' /etc/default/locale | tail -1)" \
       "swappiness=$(cat /proc/sys/vm/swappiness) node=$("$NODE_SYMLINK/bin/node" --version 2>/dev/null || echo none)" \
       "cloudflared=$(cloudflared --version 2>/dev/null | awk '{print $3}') proxy=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' /opt/magicbox-proxy/package.json)" \
       "resolv=$(grep -c '^nameserver' /etc/resolv.conf) journal=$(journalctl --disk-usage 2>/dev/null | grep -oE '[0-9.]+[MG]' | head -1) env_file=$([ -f /etc/magicbox-proxy.env ] && echo present || echo absent)"
}

main() {
  install_node
  install_proxy
  if [ "$PROXY_ONLY" = 1 ]; then restart_services 0; summary; return 0; fi
  changed="$(install_files)"
  apply_hygiene
  install_key
  cf_changed=0
  cf_out="$(install_cloudflared)" || true
  [ "$cf_out" = 1 ] && cf_changed=1
  case " $changed " in *" cloudflared.yml "*|*" cloudflared.service "*) cf_changed=1;; esac
  restart_services "$cf_changed"
  lock_root_password
  summary
}

main
