"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Smartphone, MonitorSmartphone, Wifi, WifiOff, Search } from "lucide-react";
import { getAccountDevices, getDeviceAvatarMap } from "@/app/actions/avatars";
import type { Device } from "@/types";

/**
 * Shared device-selection logic + UI, used by BOTH the create-avatar wizard
 * (`StepDevice`) and the operator Device tab (attach / change / reassign). Kept
 * in one place so the "available devices" rule (account-scoped, not already
 * attached to another avatar) and the row rendering never diverge.
 */

/** Devices of an account that are NOT already attached to another avatar. */
export function useAvailableDevices(accountId: string) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [assignedDeviceIds, setAssignedDeviceIds] = useState<Set<string>>(new Set());
  // `loadedFor` drives a DERIVED loading flag so we never call setState
  // synchronously inside the effect (React 19 lint) — every state write below
  // happens in an async callback.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    Promise.all([getAccountDevices(accountId), getDeviceAvatarMap()])
      .then(([devs, avatarMap]) => {
        if (cancelled) return;
        setDevices(devs);
        setAssignedDeviceIds(new Set(Object.keys(avatarMap)));
        setLoadedFor(accountId);
      })
      .catch(() => {
        if (cancelled) return;
        setDevices([]);
        setAssignedDeviceIds(new Set());
        setLoadedFor(accountId);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const available = useMemo(
    () => devices.filter((d) => !assignedDeviceIds.has(d.id)),
    [devices, assignedDeviceIds],
  );

  return { available, assignedCount: assignedDeviceIds.size, loading: loadedFor !== accountId };
}

interface DevicePickerListProps {
  accountId: string;
  value: string | null;
  onChange: (deviceId: string | null) => void;
}

export function DevicePickerList({ accountId, value, onChange }: DevicePickerListProps) {
  const { available, assignedCount, loading } = useAvailableDevices(accountId);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return available;
    const q = search.toLowerCase();
    return available.filter((d) => {
      const tags = Array.isArray(d.tags) ? d.tags : [];
      return (
        d.user_name?.toLowerCase().includes(q) ||
        d.db_id.toLowerCase().includes(q) ||
        d.country?.toLowerCase().includes(q) ||
        d.state.toLowerCase().includes(q) ||
        tags.some((t) => String(t).toLowerCase().includes(q))
      );
    });
  }, [available, search]);

  const selectedDevice = available.find((d) => d.id === value);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (available.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
        <MonitorSmartphone className="mb-3 h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm font-medium">No devices available</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Assign devices to this account first from the admin panel.
        </p>
      </div>
    );
  }

  return (
    <>
      {available.length > 6 && (
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
            : `${available.length} available`}
          {assignedCount > 0 && !search.trim() && (
            <span className="ml-1 font-normal text-muted-foreground">· {assignedCount} assigned</span>
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
        <DeviceOption
          label="No device"
          sublabel="Detach / assign later"
          icon={<Smartphone className="h-4 w-4 text-muted-foreground" />}
          selected={value === null}
          onClick={() => onChange(null)}
        />
        {filtered.length === 0 && search.trim() ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            No devices match &quot;{search}&quot;
          </p>
        ) : (
          filtered.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              selected={value === device.id}
              onSelect={() => onChange(device.id)}
            />
          ))
        )}
      </div>
    </>
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
        selected ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted"
      }`}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{sublabel}</p>
      </div>
      {selected && <div className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
    </button>
  );
}

export function DeviceRow({
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
        selected ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted"
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
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{device.user_name ?? device.db_id}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className="text-xs capitalize text-muted-foreground">{device.state}</span>
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
            <span className="text-[10px] text-muted-foreground">+{tags.length - 3}</span>
          )}
        </div>
      </div>
      {selected && <div className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
    </button>
  );
}
