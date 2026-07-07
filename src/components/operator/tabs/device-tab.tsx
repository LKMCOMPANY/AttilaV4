"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Plus,
  RefreshCw,
  Unlink,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Section, InfoRow } from "./device-info";
import { ProxySection } from "./proxy-section";
import { DeviceAssignDialog } from "./device-assign-dialog";
import { setAvatarDevice } from "@/app/actions/avatars";
import type { DeviceProxyFields } from "@/app/actions/device-proxy";
import type { AvatarWithRelations, Device, DeviceState } from "@/types";

const STATE_CONFIG: Record<DeviceState, { dot: string; label: string }> = {
  running: { dot: "bg-success", label: "Running" },
  stopped: { dot: "bg-muted-foreground", label: "Stopped" },
  creating: { dot: "bg-warning", label: "Creating" },
  removed: { dot: "bg-destructive", label: "Removed" },
};

interface DeviceTabProps {
  avatar: AvatarWithRelations;
  accountId: string;
  onUpdated?: (avatar: AvatarWithRelations) => void;
}

export function DeviceTab({ avatar, accountId, onUpdated }: DeviceTabProps) {
  const device = avatar.device;
  const [assignOpen, setAssignOpen] = useState(false);
  const [detaching, setDetaching] = useState(false);

  const handleAssigned = (deviceId: string | null, newDevice: Device | null) => {
    onUpdated?.({ ...avatar, device_id: deviceId, device: newDevice });
  };

  const handleDetach = async () => {
    setDetaching(true);
    try {
      const result = await setAvatarDevice(avatar.id, null);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      handleAssigned(null, null);
      toast.success("Device detached");
    } catch {
      toast.error("Failed to detach device");
    } finally {
      setDetaching(false);
    }
  };

  const assignDialog = (
    <DeviceAssignDialog
      open={assignOpen}
      onOpenChange={setAssignOpen}
      avatarId={avatar.id}
      accountId={accountId}
      currentDeviceId={avatar.device_id}
      onAssigned={handleAssigned}
    />
  );

  // No device row at all (never assigned, or hard-deleted → FK set null).
  if (!device) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="rounded-full bg-muted p-3">
          <Smartphone className="h-5 w-5 text-muted-foreground/40" />
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">No device assigned</p>
          <p className="mt-0.5 text-xs text-muted-foreground/60">
            Attach a device to this avatar to see details
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setAssignOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Attach device
        </Button>
        {assignDialog}
      </div>
    );
  }

  const handleProxyUpdated = (proxy: DeviceProxyFields) => {
    onUpdated?.({ ...avatar, device: { ...device, ...proxy } });
  };

  const isRemoved = device.state === "removed";

  return (
    <div className="space-y-5">
      {/* Device removed from the box — explicit, actionable banner */}
      {isRemoved && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-destructive">Device removed from the box</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              This device no longer exists on its box. Reassign the avatar to another device to keep it operational.
            </p>
            <Button size="sm" className="mt-2 h-7 gap-1.5 text-[11px]" onClick={() => setAssignOpen(true)}>
              <RefreshCw className="h-3 w-3" /> Reassign device
            </Button>
          </div>
        </div>
      )}

      {/* Status header + attach/change/detach controls */}
      <div className="flex items-center gap-2 rounded-lg border bg-card/50 px-3 py-2.5">
        <span className={cn("h-2 w-2 rounded-full", STATE_CONFIG[device.state].dot)} />
        <span className="text-[13px] font-medium">{device.user_name ?? device.db_id}</span>
        <span className="text-[11px] text-muted-foreground">· {STATE_CONFIG[device.state].label}</span>
        <div className="ml-auto flex items-center gap-1">
          {device.last_seen && !isRemoved && (
            <span className="mr-1 text-[10px] text-muted-foreground/60">
              {formatDistanceToNow(new Date(device.last_seen), { addSuffix: true })}
            </span>
          )}
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[10px]" onClick={() => setAssignOpen(true)}>
            <RefreshCw className="h-3 w-3" /> Change
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[10px] text-muted-foreground hover:text-destructive"
            onClick={handleDetach}
            disabled={detaching}
          >
            <Unlink className="h-3 w-3" /> Detach
          </Button>
        </div>
      </div>
      {assignDialog}

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
