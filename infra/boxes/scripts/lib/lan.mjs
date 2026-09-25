/**
 * LAN discovery of the boxes — the JavaScript twin of lib/transport.sh.
 *
 * A box is identified by its MAC (`hwaddr`) and `device_id`, both from
 * manifest.tsv; never by an address. On the current LAN the ARP table is
 * searched for the MAC (after a short :18182 sweep of the local /24 so it is
 * populated), and a candidate is trusted only once `GET /v1/get_hardware_cfg`
 * returns the expected `device_id`.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.resolve(__dirname, "..", "..", "manifest.tsv");

/** Parse manifest.tsv → [{ num, host, sshHost, tunnelId, deviceId, hwaddr }]. */
export function manifestBoxes() {
  const rows = [];
  for (const line of fs.readFileSync(MANIFEST, "utf8").split("\n")) {
    if (!/^\d/.test(line)) continue;
    const [num, tunnelId, deviceId = "", hwaddr = ""] = line.split("\t").map((s) => s.trim());
    rows.push({
      num: Number(num),
      host: `box-${num}.attila.army`,
      sshHost: `ssh-box-${num}.attila.army`,
      tunnelId,
      deviceId: deviceId || null,
      hwaddr: hwaddr ? hwaddr.toLowerCase() : null,
    });
  }
  return rows;
}

/** The local /24 prefix ("192.168.1") of the first external IPv4, or null. */
export function localSlash24() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const e of entries) {
      if ((e.family === "IPv4" || e.family === 4) && !e.internal) return e.address.split(".").slice(0, 3).join(".");
    }
  }
  return null;
}

/** IPv4s the ARP table associates with a MAC (macOS and Linux `arp -a`). */
export async function arpIpsForMac(mac) {
  try {
    const { stdout } = await execFileP("arp", ["-a"]);
    const ips = [];
    for (const line of stdout.toLowerCase().split("\n")) {
      if (!line.includes(mac)) continue;
      const m = line.match(/\((\d+\.\d+\.\d+\.\d+)\)/);
      if (m) ips.push(m[1]);
    }
    return ips;
  } catch {
    return [];
  }
}

let swept = false;
/** Touch :18182 on every host of the local /24 once, so ARP learns the boxes. */
export async function lanSweep() {
  if (swept) return;
  swept = true;
  const prefix = localSlash24();
  if (!prefix) return;
  const probes = [];
  for (let i = 1; i <= 254; i++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1000);
    probes.push(
      fetch(`http://${prefix}.${i}:18182/v1/heartbeat`, { signal: controller.signal })
        .catch(() => null)
        .finally(() => clearTimeout(t)),
    );
  }
  await Promise.all(probes);
}

async function hardwareDeviceId(ip) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`http://${ip}:18182/v1/get_hardware_cfg`, { signal: controller.signal });
    const json = await res.json();
    return json?.data?.device_id ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * LAN IP of a manifest box if it is on this LAN and proves its device_id,
 * else null. `FORCE_TUNNEL=1` disables the LAN entirely.
 */
export async function discoverLanIp(row) {
  if (process.env.FORCE_TUNNEL === "1" || !row.deviceId || !row.hwaddr) return null;
  let ips = await arpIpsForMac(row.hwaddr);
  if (ips.length === 0 && process.env.LAN_SWEEP !== "0") {
    await lanSweep();
    ips = await arpIpsForMac(row.hwaddr);
  }
  for (const ip of ips) {
    if ((await hardwareDeviceId(ip)) === row.deviceId) return ip;
  }
  return null;
}
