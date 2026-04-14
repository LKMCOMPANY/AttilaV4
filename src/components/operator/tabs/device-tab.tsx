"use client";

import { Badge } from "@/components/ui/badge";
import {
  Smartphone,
  Wifi,
  Shield,
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
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import type { AvatarWithRelations, DeviceState } from "@/types";

const STATE_CONFIG: Record<DeviceState, { dot: string; label: string }> = {
  running: { dot: "bg-success", label: "Running" },
  stopped: { dot: "bg-muted-foreground", label: "Stopped" },
  creating: { dot: "bg-warning", label: "Creating" },
  removed: { dot: "bg-destructive", label: "Removed" },
};

interface DeviceTabProps {
  avatar: AvatarWithRelations;
}

export function DeviceTab({ avatar }: DeviceTabProps) {
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

      {/* Proxy */}
      {device.proxy_enabled && (
        <Section title="Proxy" icon={Shield}>
          <InfoRow icon={Shield} label="Type" value={device.proxy_type} />
          <InfoRow icon={Shield} label="Host" value={device.proxy_host} />
          <InfoRow icon={Shield} label="Port" value={device.proxy_port} />
          <InfoRow icon={User} label="Account" value={device.proxy_account} />
          <InfoRow icon={Lock} label="Password" value={device.proxy_password ? "••••••••" : null} />
        </Section>
      )}

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

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card/50 px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-muted-foreground/60" />
        <h4 className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">
          {title}
        </h4>
      </div>
      <div className="divide-y divide-border/30">{children}</div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number | null | undefined;
}) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0 opacity-60" />
        <span>{label}</span>
      </div>
      <span className="truncate text-right text-[11px] font-medium">{value}</span>
    </div>
  );
}
