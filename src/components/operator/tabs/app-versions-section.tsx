"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { AppWindow, Keyboard, Loader2, Package } from "lucide-react";
import { getDeviceAppVersions } from "@/app/actions/device-app-versions";
import { SocialIcon } from "@/components/icons/social-icons";
import { WATCHED_PACKAGES, appNameFor } from "@/lib/maintenance/app-versions.mjs";
import { Section, InfoRow } from "./device-info";
import type { DeviceAppVersion } from "@/types";

/** `version_name` when an online read gave one, else the build code alone. */
function versionLabel(row: DeviceAppVersion): string {
  if (row.version_name) return row.version_name;
  if (row.version_code != null) return `build ${row.version_code}`;
  return "unknown";
}

const TikTokGlyph = ({ className }: { className?: string }) => <SocialIcon platform="tiktok" className={className} />;
const XGlyph = ({ className }: { className?: string }) => <SocialIcon platform="twitter" className={className} />;

function iconFor(pkg: string) {
  if (pkg === WATCHED_PACKAGES.tiktok) return TikTokGlyph;
  if (pkg === WATCHED_PACKAGES.twitter) return XGlyph;
  if (pkg === WATCHED_PACKAGES.adbkeyboard) return Keyboard;
  return AppWindow;
}

function sourceLabel(rows: DeviceAppVersion[]): string {
  const sources = new Set(rows.map((r) => r.source));
  if (sources.size === 1 && sources.has("online_v2")) return "on the running device";
  if (sources.size === 1 && sources.has("offline_packages_xml")) return "from the stopped image";
  return "device and image";
}

/**
 * The app builds recorded for the device (`device_app_versions`): the three
 * packages a job depends on, with when and how they were read. An X below the
 * version wall or a missing ADBKeyboard is worth a glance before opening the
 * stream — the maintainer files the item, this section shows the evidence.
 */
export function AppVersionsSection({ deviceId }: { deviceId: string }) {
  const [rows, setRows] = useState<DeviceAppVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The tab mounts this section keyed by device id, so a device change remounts
  // it with fresh state — no synchronous reset inside the effect.
  useEffect(() => {
    let cancelled = false;
    getDeviceAppVersions(deviceId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "App versions unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  const latest = rows?.length ? rows.map((r) => new Date(r.checked_at).getTime()).reduce((a, b) => Math.max(a, b)) : null;

  return (
    <Section title="Apps" icon={Package}>
      {rows === null && !error && (
        <div className="flex items-center gap-2 py-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Reading…
        </div>
      )}
      {error && <p className="py-1.5 text-[11px] text-muted-foreground">{error}</p>}
      {rows && rows.length === 0 && (
        <p className="py-1.5 text-[11px] text-muted-foreground">
          No app audit yet — versions appear after the next offline audit or the next session on this device.
        </p>
      )}
      {rows?.map((row) => (
        <InfoRow key={row.package} icon={iconFor(row.package)} label={appNameFor(row.package)} value={versionLabel(row)} />
      ))}
      {latest !== null && rows && (
        <p className="pt-1.5 text-[10px] text-muted-foreground/70">
          Read {formatDistanceToNow(new Date(latest), { addSuffix: true })} · {sourceLabel(rows)}
        </p>
      )}
    </Section>
  );
}
