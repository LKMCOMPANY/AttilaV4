"use client";

import { useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Smartphone,
  MonitorSmartphone,
  Wifi,
  WifiOff,
  Search,
} from "lucide-react";
import { getAccountDevices, getDeviceAvatarMap } from "@/app/actions/avatars";
import type { Device } from "@/types";
import type { StepProps } from "../types";

interface StepDeviceProps extends StepProps {
  accountId: string;
}

export function StepDevice({ data, onChange, accountId }: StepDeviceProps) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [assignedDeviceIds, setAssignedDeviceIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    Promise.all([getAccountDevices(accountId), getDeviceAvatarMap()])
      .then(([devs, avatarMap]) => {
        setDevices(devs);
        setAssignedDeviceIds(new Set(Object.keys(avatarMap)));
      })
      .catch(() => setDevices([]))
      .finally(() => setLoading(false));
  }, [accountId]);

  const availableDevices = useMemo(
    () => devices.filter((d) => !assignedDeviceIds.has(d.id)),
    [devices, assignedDeviceIds],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return availableDevices;
    const q = search.toLowerCase();
    return availableDevices.filter((d) => {
      const tags = Array.isArray(d.tags) ? d.tags : [];
      return (
        d.user_name?.toLowerCase().includes(q) ||
        d.db_id.toLowerCase().includes(q) ||
        d.country?.toLowerCase().includes(q) ||
        d.state.toLowerCase().includes(q) ||
        tags.some((t) => String(t).toLowerCase().includes(q))
      );
    });
  }, [availableDevices, search]);

  const selectedDevice = availableDevices.find((d) => d.id === data.device_id);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <h3 className="text-heading-3">Device Assignment</h3>
        <p className="text-body-sm text-muted-foreground">
          Assign a device to this avatar. You can skip and assign one later.
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : availableDevices.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
          <MonitorSmartphone className="mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm font-medium">No devices available</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Assign devices to this account first from the admin panel.
          </p>
        </div>
      ) : (
        <>
          {/* Search */}
          {availableDevices.length > 6 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search devices by name, tag, country..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          )}

          <div className="flex items-center justify-between">
            <Label className="text-label">
              {search.trim()
                ? `${filtered.length} result${filtered.length !== 1 ? "s" : ""}`
                : `${availableDevices.length} available`}
              {assignedDeviceIds.size > 0 && !search.trim() && (
                <span className="ml-1 text-muted-foreground font-normal">
                  · {assignedDeviceIds.size} assigned
                </span>
              )}
            </Label>
            {selectedDevice && (
              <Badge variant="secondary" className="gap-1.5 text-xs">
                <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                {selectedDevice.user_name ?? selectedDevice.db_id}
              </Badge>
            )}
          </div>

          <div className="max-h-[300px] space-y-1.5 overflow-y-auto rounded-lg border p-1.5 scrollbar-thin">
            {/* "No device" option */}
            <DeviceOption
              label="No device"
              sublabel="Assign a device later"
              icon={<Smartphone className="h-4 w-4 text-muted-foreground" />}
              selected={data.device_id === null}
              onClick={() => onChange({ device_id: null })}
            />

            {filtered.length === 0 && search.trim() ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No devices match "{search}"
              </p>
            ) : (
              filtered.map((device) => (
                <DeviceRow
                  key={device.id}
                  device={device}
                  selected={data.device_id === device.id}
                  onSelect={() => onChange({ device_id: device.id })}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function DeviceOption({
  label,
  sublabel,
  icon,
  selected,
  onClick,
}: {
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
        selected
          ? "bg-primary/10 ring-1 ring-primary/30"
          : "hover:bg-muted"
      }`}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{sublabel}</p>
      </div>
      {selected && <div className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
    </button>
  );
}

function DeviceRow({
  device,
  selected,
  onSelect,
}: {
  device: Device;
  selected: boolean;
  onSelect: () => void;
}) {
  const isRunning = device.state === "running";
  const tags = Array.isArray(device.tags) ? device.tags : [];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
        selected
          ? "bg-primary/10 ring-1 ring-primary/30"
          : "hover:bg-muted"
      }`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
          isRunning ? "bg-success/10" : "bg-muted"
        }`}
      >
        {isRunning ? (
          <Wifi className="h-4 w-4 text-success" />
        ) : (
          <WifiOff className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium">
          {device.user_name ?? device.db_id}
        </p>
        <div className="flex flex-wrap items-center gap-1 mt-0.5">
          <span className="text-xs text-muted-foreground capitalize">
            {device.state}
          </span>
          {device.country && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              {device.country}
            </Badge>
          )}
          {tags.slice(0, 3).map((tag) => (
            <Badge key={String(tag)} variant="outline" className="h-4 px-1 text-[10px]">
              {String(tag)}
            </Badge>
          ))}
          {tags.length > 3 && (
            <span className="text-[10px] text-muted-foreground">
              +{tags.length - 3}
            </span>
          )}
        </div>
      </div>
      {selected && <div className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
    </button>
  );
}
