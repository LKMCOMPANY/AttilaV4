/**
 * Host facts read over SSH in ONE round trip: the probe script below runs on
 * the box and prints a JSON object. Everything is read-only.
 *
 * These are the facts the API does not expose — what deploy.sh converges
 * (hostname, timezone, locale, resolvers, swappiness, managed files, key) and
 * what fills the eMMC (journal, rsyslog, mihomo logs, unused images) or the
 * SSD (orphan container directories).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BOXES_DIR, sshRun } from "./env.mjs";

const FLEET_KEY = fs.readFileSync(path.join(BOXES_DIR, "files", "authorized_keys.d", "attila-fleet.pub"), "utf8").trim().split(/\s+/)[1];

// Managed files: versioned source → path on the box (the cloudflared config is
// rendered per box and compared separately).
export const MANAGED_FILES = {
  "sysctl.d/90-attila.conf": "/etc/sysctl.d/90-attila.conf",
  "journald.conf.d/attila.conf": "/etc/systemd/journald.conf.d/attila.conf",
  "logrotate.d/rsyslog": "/etc/logrotate.d/rsyslog",
  "logrotate.d/attila-mihomo": "/etc/logrotate.d/attila-mihomo",
  "NetworkManager/conf.d/90-attila-dns.conf": "/etc/NetworkManager/conf.d/90-attila-dns.conf",
  "resolv.conf": "/etc/resolv.conf",
  "cloudflared.service": "/etc/systemd/system/cloudflared.service",
  "magicbox-proxy.service": "/etc/systemd/system/magicbox-proxy.service",
  "attila-sysctl.service": "/etc/systemd/system/attila-sysctl.service",
  "attila-sysctl.timer": "/etc/systemd/system/attila-sysctl.timer",
};

const md5 = (buf) => crypto.createHash("md5").update(buf).digest("hex");

/** md5 of every versioned managed file, keyed by its path on the box. */
export function localManagedDigests() {
  const out = {};
  for (const [src, dst] of Object.entries(MANAGED_FILES)) {
    out[dst] = md5(fs.readFileSync(path.join(BOXES_DIR, "files", src)));
  }
  return out;
}

export function renderedCloudflaredDigest(num, tunnelId) {
  const tmpl = fs.readFileSync(path.join(BOXES_DIR, "templates", "cloudflared.config.yml.tmpl"), "utf8");
  return md5(tmpl.replaceAll("__NUM__", String(num)).replaceAll("__TUNNEL_ID__", tunnelId));
}

export const PROBE = `
set +e
j() { python3 -c 'import json,sys; print(json.dumps(json.loads(sys.stdin.read())))' 2>/dev/null; }
state=/root/armcloud-container-backend-service/state
mmc=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
ssd=$(df -P /container_nswc_lv 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}')
swap_total=$(awk '/SwapTotal/ {print $2}' /proc/meminfo); swap_free=$(awk '/SwapFree/ {print $2}' /proc/meminfo)
swap_pct=0; [ "$swap_total" -gt 0 ] 2>/dev/null && swap_pct=$(( (swap_total - swap_free) * 100 / swap_total ))
journal=$(journalctl --disk-usage 2>/dev/null | grep -oE '[0-9.]+[KMGT]' | head -1)
varlog=$(du -sb --exclude=journal /var/log 2>/dev/null | cut -f1)
mihomo=$(find $state -name mihomo.log -printf '%s\\n' 2>/dev/null | awk '{s+=$1} END {print s+0}')
images=$(docker images --format '{{.Repository}}' 2>/dev/null | sort -u | paste -sd, -)
inuse=$(docker ps -a --format '{{.Image}}' 2>/dev/null | sed 's/:.*//' | sort -u | paste -sd, -)
containers=$(docker ps -a --format '{{.Names}}' 2>/dev/null | sort)
dataroot=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null)
orphans=""
for d in /container_nswc_lv/EDGE*; do
  [ -d "$d" ] || continue
  n=$(basename "$d"); echo "$containers" | grep -qx "$n" || orphans="$orphans,$n"
done
orphans=\${orphans#,}
ipv6=$(ip -6 addr show scope global 2>/dev/null | grep -c inet6)
key=$(grep -c "${FLEET_KEY}" /root/.ssh/authorized_keys 2>/dev/null)
rootpw=$(sshd -T -C user=root,addr=192.168.1.2,host=x 2>/dev/null | awk '/^passwordauthentication/ {print $2}')
digests=""
for f in ${Object.values(MANAGED_FILES).join(" ")} /etc/cloudflared/config.yml; do
  [ -f "$f" ] && digests="$digests,\\"$f\\":\\"$(md5sum "$f" | cut -c1-32)\\""
done
digests=\${digests#,}
load1=$(cut -d' ' -f1 /proc/loadavg)
up=$(cut -d. -f1 /proc/uptime)
lanip=$(hostname -I 2>/dev/null | awk '{print $1}')
cat <<EOF
{"hostname":"$(hostname)","timezone":"$(timedatectl show -p Timezone --value 2>/dev/null)","lang":"$(sed -n 's/^LANG=//p' /etc/default/locale | tail -1)",
"swappiness":$(cat /proc/sys/vm/swappiness),"swap_pct":$swap_pct,"mmc_pct":\${mmc:-null},"ssd_pct":\${ssd:-null},
"journal":"$journal","varlog_bytes":\${varlog:-0},"mihomo_bytes":\${mihomo:-0},
"images":"$images","images_in_use":"$inuse","docker_root":"$dataroot","orphans":"$orphans",
"ipv6_global":$ipv6,"key_authorized":$([ "$key" -ge 1 ] && echo true || echo false),"root_password_auth":"$rootpw",
"env_file":$([ -f /etc/magicbox-proxy.env ] && echo true || echo false),
"proxy_env_pinned":$(systemctl show -p Environment --value magicbox-proxy 2>/dev/null | grep -q "API_HOST=" && echo true || echo false),
"resolvers":"$(grep '^nameserver' /etc/resolv.conf | awk '{print $2}' | paste -sd, -)",
"cloudflared":"$(cloudflared --version 2>/dev/null | awk '{print $3}')","node":"$(/opt/node/bin/node --version 2>/dev/null)",
"proxy_exec":"$(grep -m1 '^ExecStart=' /etc/systemd/system/magicbox-proxy.service | cut -d= -f2-)",
"logrotate_timer":"$(systemctl is-active logrotate.timer 2>/dev/null)","supervisor_cbs":"$(supervisorctl status cbs_go 2>/dev/null | awk '{print $2}')",
"load1":$load1,"uptime_s":$up,"lan_ip":"$lanip","digests":{$digests}}
EOF
`;

/** Read the host facts of one box; `target` is a LAN ip or the ssh-box host. */
export async function readHostFacts(target, { viaTunnel = false } = {}) {
  const out = await sshRun(target, PROBE, { viaTunnel });
  if (!out) return null;
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(out.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Human size for a byte count. */
export function fmtBytes(n) {
  if (n == null) return "?";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}
