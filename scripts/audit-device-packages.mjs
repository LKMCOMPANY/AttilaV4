#!/usr/bin/env node
/**
 * OFFLINE package audit — what is installed on every device, without booting one.
 *
 * The online audit (`audit-adbkeyboard.mjs`) can only see devices that are
 * running, so it silently skipped a whole box and left `adbkeyboard_installed`
 * NULL on 127 rows, which then read as "nothing installed". This reads the truth
 * straight off each stopped container's `data.img` with `debugfs`, over SSH:
 * 451 devices inventoried, zero boots, no VMOS ceiling to respect.
 *
 * How: Android keeps user apps under `/data/app/~~<random>~~/<package>-<hash>/`.
 * Inside the image that is `/app/<random>/<package>-<hash>`, two `debugfs -R ls`
 * away. Read-only — `debugfs` is never given `-w`.
 *
 * Requires `sshpass` and `cloudflared` (same as infra/boxes/scripts/deploy.sh),
 * plus BOX_SSH_PASSWORD (infra/boxes/.env) and the CF Access service token.
 *
 * Usage (from Attila V4/):
 *   node scripts/audit-device-packages.mjs                 # report + persist
 *   node scripts/audit-device-packages.mjs --dry-run       # report only
 *   node scripts/audit-device-packages.mjs --box box-3.attila.army
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchDevicesWithBoxes, recordPackageAudit } from "./lib/fleet.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SSH_TIMEOUT_MS = 300_000;

// Packages we care about. ADBKeyboard is the hard requirement for any typing
// (AGENTS.md rule 3); the social apps decide whether a device can run a job at all.
const PACKAGES = {
  adbkeyboard: "com.android.adbkeyboard",
  tiktok: "com.zhiliaoapp.musically",
  twitter: "com.twitter.android",
};

/** Listed on the box: emit `db_id<TAB>space separated package dirs` per container. */
const REMOTE_SCRIPT = `
for D in /container_nswc_lv/EDGE*; do
  ID=$(basename "$D"); F="$D/data/data.img"; [ -f "$F" ] || continue
  pkgs=""
  for SUB in $(debugfs -R "ls -p /app" "$F" 2>/dev/null | cut -d/ -f6 | grep -vE '^\\.?\\.?$|^$'); do
    pkgs="$pkgs $(debugfs -R "ls -p /app/$SUB" "$F" 2>/dev/null | cut -d/ -f6 | grep -vE '^\\.?\\.?$|^$' | tr '\\n' ' ')"
  done
  printf '%s\\t%s\\n' "$ID" "$pkgs"
done
`;

function loadBoxSshPassword() {
  const envFile = path.join(PROJECT_ROOT, "infra", "boxes", ".env");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
      const m = line.trim().match(/^BOX_SSH_PASSWORD=(.*)$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  }
  return process.env.BOX_SSH_PASSWORD ?? null;
}

/** `box-3.attila.army` → `ssh-box-3.attila.army` (manifest convention). */
function sshHostFor(tunnelHostname) {
  return `ssh-${tunnelHostname}`;
}

/**
 * Feed the audit script to a box's shell and collect its stdout.
 *
 * Uses `spawn` rather than `execFile`: the async `execFile` has no `input`
 * option (that is `execFileSync`), so `bash -s` would sit waiting on a stdin
 * that never closes until the timeout fired.
 */
function runOverSsh(tunnelHostname, sshPassword, script) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "sshpass",
      [
        "-e",
        "ssh",
        "-o", "ConnectTimeout=25",
        "-o", "PreferredAuthentications=password",
        "-o", "PubkeyAuthentication=no",
        "-o", "StrictHostKeyChecking=no",
        "-o", "LogLevel=ERROR",
        "-o", "ProxyCommand=cloudflared access ssh --hostname %h",
        `root@${sshHostFor(tunnelHostname)}`,
        "bash -s",
      ],
      {
        env: {
          ...process.env,
          SSHPASS: sshPassword,
          TUNNEL_SERVICE_TOKEN_ID: process.env.CF_ACCESS_CLIENT_ID,
          TUNNEL_SERVICE_TOKEN_SECRET: process.env.CF_ACCESS_CLIENT_SECRET,
        },
      },
    );

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out after ${SSH_TIMEOUT_MS / 1000}s`));
    }, SSH_TIMEOUT_MS);

    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`ssh exited ${code}: ${stderr.trim().slice(0, 200)}`));
    });

    child.stdin.end(script);
  });
}

async function readBoxPackages(tunnelHostname, sshPassword) {
  const stdout = await runOverSsh(tunnelHostname, sshPassword, REMOTE_SCRIPT);

  const byDbId = new Map();
  for (const line of stdout.split("\n")) {
    const [dbId, pkgs] = line.split("\t");
    if (!dbId?.startsWith("EDGE")) continue;
    const blob = pkgs ?? "";
    byDbId.set(dbId, {
      adbkeyboard: blob.includes(PACKAGES.adbkeyboard),
      tiktok: blob.includes(PACKAGES.tiktok),
      twitter: blob.includes(PACKAGES.twitter),
      anyApp: blob.trim().length > 0,
    });
  }
  return byDbId;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const boxArgIndex = process.argv.indexOf("--box");
  const onlyBox = boxArgIndex > -1 ? process.argv[boxArgIndex + 1] : null;

  const sshPassword = loadBoxSshPassword();
  if (!sshPassword) {
    console.error("Missing BOX_SSH_PASSWORD (infra/boxes/.env or the environment)");
    process.exit(1);
  }

  const devices = (await fetchDevicesWithBoxes()).filter(
    (d) => d.db_id && d.boxes?.tunnel_hostname && d.state !== "removed",
  );

  const byBox = new Map();
  for (const d of devices) {
    const host = d.boxes.tunnel_hostname;
    if (onlyBox && host !== onlyBox) continue;
    if (!byBox.has(host)) byBox.set(host, []);
    byBox.get(host).push(d);
  }

  console.log(`=== offline package audit ${dryRun ? "(DRY RUN)" : ""} ===`);
  console.log("box                     devices  adbkbd   tiktok  twitter  no-apps");

  const totals = { devices: 0, adbkeyboard: 0, tiktok: 0, twitter: 0, noApps: 0, unseen: 0 };

  for (const [host, list] of [...byBox].sort()) {
    let observed;
    try {
      observed = await readBoxPackages(host, sshPassword);
    } catch (err) {
      console.error(`${host.padEnd(24)} SSH failed: ${(err.message ?? err).toString().slice(0, 120)}`);
      continue;
    }

    const tally = { devices: 0, adbkeyboard: 0, tiktok: 0, twitter: 0, noApps: 0 };
    for (const device of list) {
      const found = observed.get(device.db_id);
      if (!found) {
        totals.unseen++;
        continue;
      }
      tally.devices++;
      if (found.adbkeyboard) tally.adbkeyboard++;
      if (found.tiktok) tally.tiktok++;
      if (found.twitter) tally.twitter++;
      if (!found.anyApp) tally.noApps++;

      if (!dryRun) {
        await recordPackageAudit(device.id, {
          adbkeyboardInstalled: found.adbkeyboard,
          tiktokInstalled: found.tiktok,
          twitterInstalled: found.twitter,
        });
      }
    }

    console.log(
      `${host.padEnd(24)}${String(tally.devices).padStart(7)}` +
        `${String(tally.adbkeyboard).padStart(9)}${String(tally.tiktok).padStart(9)}` +
        `${String(tally.twitter).padStart(9)}${String(tally.noApps).padStart(9)}`,
    );
    for (const k of Object.keys(tally)) totals[k] += tally[k];
  }

  console.log(
    `${"TOTAL".padEnd(24)}${String(totals.devices).padStart(7)}` +
      `${String(totals.adbkeyboard).padStart(9)}${String(totals.tiktok).padStart(9)}` +
      `${String(totals.twitter).padStart(9)}${String(totals.noApps).padStart(9)}`,
  );

  const pct = (n) => (totals.devices ? `${Math.round((100 * n) / totals.devices)}%` : "—");
  console.log(
    `\ncoverage: ADBKeyboard ${pct(totals.adbkeyboard)} · TikTok ${pct(totals.tiktok)} · X ${pct(totals.twitter)}`,
  );
  console.log(
    `a device with no social app cannot run a job: ${totals.devices - Math.max(totals.tiktok, totals.twitter)} affected`,
  );
  if (totals.unseen) {
    console.log(`${totals.unseen} DB row(s) had no container on the box (run reconcile-devices.mjs)`);
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
