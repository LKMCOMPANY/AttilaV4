"use client";

import { Badge } from "@/components/ui/badge";
import {
  Smartphone,
  Wifi,
  HardDrive,
  Monitor,
  Battery,
  Globe,
  Clock,
  Cpu,
  Tag,
  Hash,
  Image,
  Eye,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Section, InfoRow } from "./device-info";
import { ProxySection } from "./proxy-section";
import type { DeviceProxyFields } from "@/app/actions/device-proxy";
import type { AvatarWithRelations, DeviceState } from "@/types";

const STATE_CONFIG: Record<DeviceState, { dot: string; label: string }> = {
  running: { dot: "bg-success", label: "Running" },
  stopped: { dot: "bg-muted-foreground", label: "Stopped" },
  creating: { dot: "bg-warning", label: "Creating" },
  removed: { dot: "bg-destructive", label: "Removed" },
};

interface DeviceTabProps {
  avatar: AvatarWithRelations;
  onUpdated?: (avatar: AvatarWithRelations) => void;
}

export function DeviceTab({ avatar, onUpdated }: DeviceTabProps) {
  const device = avatar.device;

  if (!device) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="rounded-full bg-muted p-3">
          <Smartphone className="h-5 w-5 text-muted-foreground/40" />
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">No device assigned</p>
          <p className="mt-0.5 text-xs text-muted-foreground/60">
            Assign a device to this avatar to see details
          </p>
        </div>
      </div>
    );
  }

  const handleProxyUpdated = (proxy: DeviceProxyFields) => {
    onUpdated?.({ ...avatar, device: { ...device, ...proxy } });
  };

  return (
    <div className="space-y-5">
      {/* Status header */}
      <div className="flex items-center gap-2 rounded-lg border bg-card/50 px-3 py-2.5">
        <span className={cn("h-2 w-2 rounded-full", STATE_CONFIG[device.state].dot)} />
        <span className="text-[13px] font-medium">{device.user_name ?? device.db_id}</span>
        <span className="text-[11px] text-muted-foreground">· {STATE_CONFIG[device.state].label}</span>
        {device.last_seen && (
          <span className="ml-auto text-[10px] text-muted-foreground/60">
            {formatDistanceToNow(new Date(device.last_seen), { addSuffix: true })}
          </span>
        )}
      </div>

      {/* Hardware */}
      <Section title="Hardware" icon={Cpu}>
        <InfoRow icon={Hash} label="DB ID" value={device.db_id} />
        <InfoRow icon={User} label="Name" value={device.user_name} />
        <InfoRow icon={Smartphone} label="Model" value={device.model} />
        <InfoRow icon={HardDrive} label="Brand" value={device.brand} />
        <InfoRow icon={Hash} label="Serial" value={device.serial} />
        <InfoRow icon={Monitor} label="Resolution" value={device.resolution} />
        <InfoRow icon={HardDrive} label="Memory" value={device.memory_mb ? `${device.memory_mb} MB` : null} />
        <InfoRow icon={Monitor} label="DPI" value={device.dpi} />
        <InfoRow icon={Eye} label="FPS" value={device.fps} />
        <InfoRow icon={Battery} label="Battery" value={device.battery_level != null ? `${device.battery_level}%` : null} />
      </Section>

      {/* Software */}
      <Section title="Software" icon={Monitor}>
        <InfoRow icon={Image} label="Image" value={device.image} />
        <InfoRow icon={Smartphone} label="AOSP" value={device.aosp_version} />
        <InfoRow icon={Monitor} label="Screen" value={device.screen_state} />
        <InfoRow icon={Monitor} label="Foreground App" value={device.foreground_app} />
      </Section>

      {/* Network */}
      <Section title="Network" icon={Globe}>
        <InfoRow icon={Globe} label="Country" value={device.country} />
        <InfoRow icon={Globe} label="Locale" value={device.locale} />
        <InfoRow icon={Clock} label="Timezone" value={device.timezone} />
        <InfoRow icon={Wifi} label="Docker IP" value={device.docker_ip} />
      </Section>

      {/* Proxy — read, test, edit */}
      <ProxySection key={device.id} device={device} onProxyUpdated={handleProxyUpdated} />

      {/* Tags */}
      {device.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <Tag className="h-3 w-3 text-muted-foreground/40" />
          {device.tags.map((tag) => (
            <Badge key={String(tag)} variant="outline" className="h-5 text-[10px]">
              {String(tag)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
