"use client";

import { useCallback, useState, useTransition } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Smartphone,
  Wifi,
  WifiOff,
  User,
  RefreshCw,
  Loader2,
  ChevronRight,
  Cpu,
  Globe,
  Shield,
  Tag,
} from "lucide-react";
import {
  assignDeviceToAccount,
  unassignDevice,
  syncDeviceDetail,
} from "@/app/actions/devices";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Account, Device } from "@/types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs text-right font-mono truncate">{value}</span>
    </div>
  );
}

function SectionLabel({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <Icon className="h-3 w-3 text-muted-foreground" />
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

function SectionEmpty({ text }: { text: string }) {
  return (
    <p className="py-0.5 text-[11px] text-muted-foreground/60 italic">{text}</p>
  );
}

function hasHardwareData(device: Device) {
  return !!(
    device.brand ||
    device.model ||
    device.aosp_version ||
    device.resolution ||
    device.memory_mb ||
    device.image
  );
}

function hasNetworkData(device: Device) {
  return !!(
    device.country ||
    device.locale ||
    device.timezone ||
    device.docker_ip ||
    device.battery_level !== null
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DeviceItemProps {
  device: Device;
  accounts: Account[];
  onUpdated: () => void;
}

export function DeviceItem({ device, accounts, onUpdated }: DeviceItemProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isRunning = device.state === "running";
  const isRemoved = device.state === "removed";

  const handleSync = useCallback(() => {
    startTransition(async () => {
      const result = await syncDeviceDetail(device.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Device refreshed");
        onUpdated();
      }
    });
  }, [device.id, onUpdated, startTransition]);

  const handleAssign = useCallback(
    (accountId: string | null) => {
      if (!accountId) return;
      startTransition(async () => {
        if (accountId === "none") {
          const result = await unassignDevice({ deviceId: device.id });
          if (result.error) {
            toast.error(result.error);
          } else {
            toast.success("Device unassigned");
            onUpdated();
          }
        } else {
          const result = await assignDeviceToAccount({
            deviceId: device.id,
            accountId,
          });
          if (result.error) {
            toast.error(result.error);
          } else {
            toast.success("Device assigned");
            onUpdated();
          }
        }
      });
    },
    [device.id, onUpdated, startTransition]
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      {/* Trigger row */}
      <CollapsibleTrigger
        className={cn(
          "w-full rounded-md border px-3 py-2 text-left transition-all focus-tactical",
          "hover:border-[var(--card-hover-border)]",
          open
            ? "border-primary/30 bg-primary/5 rounded-b-none"
            : "border-transparent hover:bg-muted/50",
          isRemoved && "opacity-50"
        )}
      >
        <div className="flex items-center gap-3">
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-90"
            )}
          />

          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              isRunning
                ? "bg-success"
                : isRemoved
                  ? "bg-destructive"
                  : "bg-muted-foreground/40"
            )}
          />

          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Smartphone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium truncate">
              {device.user_name || device.db_id}
            </span>
          </div>

          {device.account_id && (
            <span title="Assigned to account">
              <User className="h-3 w-3 shrink-0 text-primary/60" />
            </span>
          )}

          {device.resolution && (
            <span className="hidden text-xs text-muted-foreground font-mono sm:inline">
              {device.resolution}
            </span>
          )}

          {device.country && (
            <span className="text-xs text-muted-foreground font-mono shrink-0">
              {device.country}
            </span>
          )}

          <span title={device.proxy_enabled ? "Proxy active" : "No proxy"}>
            {device.proxy_enabled ? (
              <Wifi className="h-3 w-3 shrink-0 text-success" />
            ) : (
              <WifiOff className="h-3 w-3 shrink-0 text-muted-foreground/40" />
            )}
          </span>

          <span
            className={cn(
              "text-xs shrink-0 min-w-[52px] text-right",
              isRunning
                ? "text-success"
                : isRemoved
                  ? "text-destructive"
                  : "text-muted-foreground"
            )}
          >
            {device.state}
          </span>
        </div>
      </CollapsibleTrigger>

      {/* Expandable detail panel */}
      <CollapsibleContent>
        <div className="rounded-b-md border border-t-0 border-primary/30 bg-primary/5 px-4 py-3">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Hardware */}
            <div>
              <SectionLabel icon={Cpu} label="Hardware" />
              {hasHardwareData(device) ? (
                <div>
                  <DataRow label="Android" value={device.aosp_version} />
                  <DataRow label="Resolution" value={device.resolution} />
                  <DataRow
                    label="Memory"
                    value={
                      device.memory_mb !== null
                        ? `${device.memory_mb} MB`
                        : null
                    }
                  />
                  <DataRow label="DPI" value={device.dpi} />
                  <DataRow label="FPS" value={device.fps} />
                  <DataRow label="Brand" value={device.brand} />
                  <DataRow label="Model" value={device.model} />
                  <DataRow label="Serial" value={device.serial} />
                  <DataRow
                    label="Image"
                    value={
                      device.image ? (
                        <span className="text-[10px]">
                          {device.image.split(":")[0]?.split("_").pop()}
                        </span>
                      ) : null
                    }
                  />
                </div>
              ) : (
                <SectionEmpty text="No data. Refresh." />
              )}
            </div>

            {/* Network & Locale */}
            <div>
              <SectionLabel icon={Globe} label="Network" />
              {hasNetworkData(device) ? (
                <div>
                  <DataRow label="Country" value={device.country} />
                  <DataRow label="Locale" value={device.locale} />
                  <DataRow label="Timezone" value={device.timezone} />
                  <DataRow label="Docker IP" value={device.docker_ip} />
                  <DataRow
                    label="Battery"
                    value={
                      device.battery_level !== null
                        ? `${device.battery_level}%`
                        : null
                    }
                  />
                </div>
              ) : (
                <SectionEmpty text="Available when running." />
              )}
            </div>

            {/* Proxy */}
            <div>
              <SectionLabel icon={Shield} label="Proxy" />
              {device.proxy_enabled ? (
                <div>
                  <DataRow
                    label="Status"
                    value={
                      <span className="text-success font-sans">Active</span>
                    }
                  />
                  <DataRow label="Type" value={device.proxy_type} />
                  <DataRow
                    label="Host"
                    value={`${device.proxy_host}:${device.proxy_port}`}
                  />
                  <DataRow label="Account" value={device.proxy_account} />
                  <DataRow label="Password" value={device.proxy_password} />
                </div>
              ) : (
                <SectionEmpty text="No proxy configured." />
              )}
            </div>

            {/* Assignment + Meta */}
            <div>
              <SectionLabel icon={Tag} label="Assignment" />
              <Select
                value={device.account_id ?? "none"}
                onValueChange={handleAssign}
                disabled={isPending}
              >
                <SelectTrigger size="sm" className="mb-2">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Separator className="my-2" />

              <div>
                <DataRow
                  label="db_id"
                  value={
                    <span className="text-[10px]">{device.db_id}</span>
                  }
                />
                <DataRow
                  label="Last seen"
                  value={
                    device.last_seen
                      ? new Date(device.last_seen).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Never"
                  }
                />
                <DataRow
                  label="ID"
                  value={
                    <span className="text-[10px] opacity-60">
                      {device.id.slice(0, 8)}
                    </span>
                  }
                />
              </div>

              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full h-7 text-xs"
                onClick={handleSync}
                disabled={isPending}
              >
                {isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                {isPending ? "Refreshing..." : "Refresh"}
              </Button>
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
