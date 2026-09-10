import { fetchPackageInfo, shellSafe } from "@/lib/box-api";
import type { DeviceRef } from "@/lib/engine/device";
import { launcherActivityOf } from "./screens";

/**
 * What build of a package the device carries — read from the v2 agent when
 * the host can reach it, from the guest's own `dumpsys package` when it
 * cannot. Measured 10 September 2026 on box-1 (agent 1.0.8): the host route
 * answered "no route to host" while the guest shell was fine; without this
 * fallback a probe declared X "not installed" and filed a false item.
 */

export interface PackageFacts {
  packageName: string;
  installed: boolean;
  versionName: string | null;
  versionCode: number | null;
  launcherActivity: string | null;
  /** How the fact was established — `v2`, `shell`, or `unknown` when neither answered. */
  source: "v2" | "shell" | "unknown";
}

export class PackageReadError extends Error {
  constructor(dbId: string, detail: string) {
    super(`Package read failed on ${dbId}: ${detail}`);
    this.name = "PackageReadError";
  }
}

/** `versionCode=311860000 minSdk=…` and `versionName=11.86.0-release.0` from `dumpsys package`. */
export function parseDumpsysPackage(output: string): { versionName: string | null; versionCode: number | null; found: boolean } {
  const code = /versionCode=(\d+)/.exec(output);
  const name = /versionName=([^\s]+)/.exec(output);
  const found = /Package \[|Packages:|versionCode=/.test(output);
  return { versionName: name?.[1] ?? null, versionCode: code ? Number(code[1]) : null, found };
}

/**
 * Facts for the requested packages. `installed: false` is asserted only when
 * a reader actually answered; a device that answers nothing throws, so the
 * caller fails the task instead of filing an "app missing" that is not true.
 */
export async function readPackages(dev: DeviceRef, packageNames: readonly string[]): Promise<PackageFacts[]> {
  try {
    const infos = await fetchPackageInfo(dev.tunnelHostname, dev.dbId, packageNames);
    // `package/list` on 1.1.3 only covers launcher apps; a package absent from
    // the answer is confirmed through the shell before being called missing.
    const facts = await Promise.all(
      packageNames.map(async (pkg) => {
        const info = infos.find((p) => p.package_name === pkg);
        if (info) {
          return {
            packageName: pkg,
            installed: true,
            versionName: info.version_name ?? null,
            versionCode: info.version_code ?? null,
            launcherActivity: launcherActivityOf(info.launcher_activity),
            source: "v2" as const,
          };
        }
        return readOneViaShell(dev, pkg);
      }),
    );
    return facts;
  } catch {
    return Promise.all(packageNames.map((pkg) => readOneViaShell(dev, pkg)));
  }
}

/** Printed after the filter: proof the shell ran to the end, whatever grep found. */
const SHELL_SENTINEL = "__attila_pkg_done__";

/**
 * `dumpsys` must be read to EOF: a `grep -m2` that exits early closes the pipe,
 * dumpsys dies of "Broken pipe" and the guest shell reports a failure although
 * the two lines were there (measured 10 September 2026 on box-1). So grep reads
 * everything, and a sentinel tells "no match" (package absent) apart from "the
 * shell did not answer" — only the latter is an error.
 */
async function readOneViaShell(dev: DeviceRef, pkg: string): Promise<PackageFacts> {
  const result = await shellSafe(
    dev.tunnelHostname,
    dev.dbId,
    `dumpsys package ${pkg} 2>/dev/null | grep -E 'versionCode=|versionName='; echo ${SHELL_SENTINEL}`,
  );
  if (!result || !result.message.includes(SHELL_SENTINEL)) {
    throw new PackageReadError(dev.dbId, `neither the v2 agent nor the shell answered for ${pkg}`);
  }
  const parsed = parseDumpsysPackage(result.message.replace(SHELL_SENTINEL, ""));
  return {
    packageName: pkg,
    installed: parsed.found,
    versionName: parsed.versionName,
    versionCode: parsed.versionCode,
    launcherActivity: null,
    source: "shell",
  };
}
