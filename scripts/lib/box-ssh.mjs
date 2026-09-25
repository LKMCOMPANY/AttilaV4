/**
 * Shell access to a box host, for the things the VMOS API cannot do.
 *
 * The Container and Android APIs cover everything that happens *inside* a
 * running container. They cannot touch a container that is stopped, and that
 * is exactly where the cheap fleet-wide work lives: reading and writing the
 * guest's data partition (`data.img`) offline, with `debugfs`, without paying
 * for 450 Android boots.
 *
 * Auth is a password from `infra/boxes/.env`, tunnelled through Cloudflare
 * Access — the same path `deploy.sh` uses.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./dotenv.mjs";
import { discoverLanIp, manifestBoxes } from "../../infra/boxes/scripts/lib/lan.mjs";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** Generous by default: a fleet-wide `debugfs` sweep is minutes, not seconds. */
export const DEFAULT_SSH_TIMEOUT_MS = 300_000;

/** Read the shared box password from `infra/boxes/.env`, or the environment. */
export function loadBoxSshPassword() {
  loadEnvFile(path.join(PROJECT_ROOT, "infra", "boxes", ".env"));
  return process.env.BOX_SSH_PASSWORD ?? null;
}

/** `box-3.attila.army` → `ssh-box-3.attila.army` (manifest convention). */
export function sshHostFor(tunnelHostname) {
  return `ssh-${tunnelHostname}`;
}

/**
 * Feed a script to a box's shell and collect its stdout.
 *
 * Uses `spawn` rather than `execFile`: the async `execFile` has no `input`
 * option (that is `execFileSync`), so `bash -s` would sit waiting on a stdin
 * that never closes until the timeout fired.
 */
// LAN first, tunnel otherwise (25 Sep 2026): the box is found on the current
// LAN by MAC + device_id (manifest.tsv, infra/boxes/scripts/lib/lan.mjs) and
// SSH'd directly; the cloudflared ProxyCommand is the fallback. Cached per run.
const lanIpByHost = new Map();
async function sshTargetFor(tunnelHostname) {
  if (!lanIpByHost.has(tunnelHostname)) {
    const row = manifestBoxes().find((m) => m.host === tunnelHostname);
    lanIpByHost.set(tunnelHostname, row ? await discoverLanIp(row).catch(() => null) : null);
  }
  const ip = lanIpByHost.get(tunnelHostname);
  return ip
    ? { host: ip, extra: [] }
    : { host: sshHostFor(tunnelHostname), extra: ["-o", "ProxyCommand=cloudflared access ssh --hostname %h"] };
}

export async function runOverSsh(
  tunnelHostname,
  sshPassword,
  script,
  { timeoutMs = DEFAULT_SSH_TIMEOUT_MS } = {},
) {
  const target = await sshTargetFor(tunnelHostname);
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
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", "LogLevel=ERROR",
        ...target.extra,
        `root@${target.host}`,
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
      reject(new Error(`timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

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
