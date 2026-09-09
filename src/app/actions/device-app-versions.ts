"use server";

import { z } from "zod";
import { requireActionSession } from "@/lib/auth/session";
import { WATCHED_PACKAGE_ORDER } from "@/lib/maintenance/app-versions.mjs";
import type { DeviceAppVersion } from "@/types";

/**
 * App builds recorded for one device (`device_app_versions`), read under the
 * caller's RLS — the device's own visibility rule applies. Watched packages
 * first, then anything else alphabetically.
 */
export async function getDeviceAppVersions(deviceId: string): Promise<DeviceAppVersion[]> {
  const parsed = z.string().uuid().safeParse(deviceId);
  if (!parsed.success) return [];
  const ctx = await requireActionSession();
  const { data, error } = await ctx.supabase
    .from("device_app_versions")
    .select("device_id, package, version_name, version_code, checked_at, source")
    .eq("device_id", parsed.data);
  if (error) throw new Error(`device_app_versions: ${error.message}`);
  const rank = (pkg: string) => {
    const index = WATCHED_PACKAGE_ORDER.indexOf(pkg);
    return index < 0 ? WATCHED_PACKAGE_ORDER.length : index;
  };
  return ((data ?? []) as DeviceAppVersion[]).sort((a, b) => {
    const left = rank(a.package);
    const right = rank(b.package);
    return left === right ? a.package.localeCompare(b.package) : left - right;
  });
}
