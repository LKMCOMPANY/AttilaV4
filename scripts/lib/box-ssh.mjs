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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** Generous by default: a fleet-wide `debugfs` sweep is minutes, not seconds. */
export const DEFAULT_SSH_TIMEOUT_MS = 300_000;

/** Read the shared box password from `infra/boxes/.env`, or the environment. */
export function loadBoxSshPassword() {
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
export function runOverSsh(
  tunnelHostname,
  sshPassword,
  script,
  { timeoutMs = DEFAULT_SSH_TIMEOUT_MS } = {},
) {
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
