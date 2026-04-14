"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Sun,
  Power,
  ExternalLink,
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

const STATE_CONFIG: Record<DeviceState, { color: string; dot: string; label: string }> = {
  running: { color: "bg-success/15 text-success", dot: "bg-success", label: "Running" },
  stopped: { color: "bg-muted text-muted-foreground", dot: "bg-muted-foreground", label: "Stopped" },
  creating: { color: "bg-warning/15 text-warning", dot: "bg-warning", label: "Creating" },
  removed: { color: "bg-destructive/15 text-destructive", dot: "bg-destructive", label: "Removed" },
};

interface DevicePanelProps {
  avatar: AvatarWithRelations | null;
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

export function DevicePanel({ avatar }: DevicePanelProps) {
  const device = avatar?.device;

  return (
    <div className="@container/device flex h-full flex-col bg-background">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-2">
        <div className="flex gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px] @[280px]/device:px-2.5"
                  disabled={!device}
                />
              }
            >
              <Sun className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden @[280px]/device:inline">Sleep / Awake</span>
            </TooltipTrigger>
            <TooltipContent>Sleep / Awake</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px] @[280px]/device:px-2.5"
                  disabled={!device}
                />
              }
            >
              <Power className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden @[280px]/device:inline">ON / OFF</span>
            </TooltipTrigger>
            <TooltipContent>ON / OFF</TooltipContent>
          </Tooltip>
        </div>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-[11px]"
                disabled={!device}
              />
            }
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden @[280px]/device:inline">Detach</span>
          </TooltipTrigger>
          <TooltipContent>Open in new window</TooltipContent>
        </Tooltip>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col items-center gap-4 p-4">
          {/* Android device mockup */}
          <div className="flex w-full flex-col items-center gap-2.5">
            <DeviceMockup device={device} />
            {device && (
              <div className="flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 rounded-full", STATE_CONFIG[device.state].dot)} />
                <span className="text-[11px] font-medium text-muted-foreground">
                  {STATE_CONFIG[device.state].label}
                </span>
                {device.last_seen && (
                  <>
                    <span className="text-[10px] text-border">·</span>
                    <span className="text-[10px] text-muted-foreground/60">
                      {formatDistanceToNow(new Date(device.last_seen), { addSuffix: true })}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Device data in accordions */}
          {device ? (
            <div className="w-full">
              <Accordion defaultValue={["hardware"]}>
                <AccordionItem value="hardware">
                  <AccordionTrigger className="py-2 text-[11px] hover:no-underline">
                    <div className="flex items-center gap-1.5">
                      <Cpu className="h-3 w-3 text-muted-foreground/60" />
                      <span className="font-semibold tracking-wide uppercase">Hardware</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="divide-y divide-border/30 pb-1">
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
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="software">
                  <AccordionTrigger className="py-2 text-[11px] hover:no-underline">
                    <div className="flex items-center gap-1.5">
                      <Monitor className="h-3 w-3 text-muted-foreground/60" />
                      <span className="font-semibold tracking-wide uppercase">Software</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="divide-y divide-border/30 pb-1">
                      <InfoRow icon={Image} label="Image" value={device.image} />
                      <InfoRow icon={Smartphone} label="AOSP" value={device.aosp_version} />
                      <InfoRow icon={Monitor} label="Screen" value={device.screen_state} />
                      <InfoRow icon={Monitor} label="Foreground App" value={device.foreground_app} />
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="network">
                  <AccordionTrigger className="py-2 text-[11px] hover:no-underline">
                    <div className="flex items-center gap-1.5">
                      <Globe className="h-3 w-3 text-muted-foreground/60" />
                      <span className="font-semibold tracking-wide uppercase">Network</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="divide-y divide-border/30 pb-1">
                      <InfoRow icon={Globe} label="Country" value={device.country} />
                      <InfoRow icon={Globe} label="Locale" value={device.locale} />
                      <InfoRow icon={Clock} label="Timezone" value={device.timezone} />
                      <InfoRow icon={Wifi} label="Docker IP" value={device.docker_ip} />
                    </div>
                  </AccordionContent>
                </AccordionItem>

                {device.proxy_enabled && (
                  <AccordionItem value="proxy">
                    <AccordionTrigger className="py-2 text-[11px] hover:no-underline">
                      <div className="flex items-center gap-1.5">
                        <Shield className="h-3 w-3 text-muted-foreground/60" />
                        <span className="font-semibold tracking-wide uppercase">Proxy</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="divide-y divide-border/30 pb-1">
                        <InfoRow icon={Shield} label="Type" value={device.proxy_type} />
                        <InfoRow icon={Shield} label="Host" value={device.proxy_host} />
                        <InfoRow icon={Shield} label="Port" value={device.proxy_port} />
                        <InfoRow icon={User} label="Account" value={device.proxy_account} />
                        <InfoRow icon={Lock} label="Password" value={device.proxy_password ? "••••••••" : null} />
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}
              </Accordion>

              {/* Tags */}
              {device.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  <Tag className="h-3 w-3 text-muted-foreground/40" />
                  {device.tags.map((tag) => (
                    <Badge key={String(tag)} variant="outline" className="h-5 text-[10px]">
                      {String(tag)}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="rounded-full bg-muted p-3">
                <Smartphone className="h-5 w-5 text-muted-foreground/40" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {avatar ? "No device assigned" : "Select an avatar"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground/60">
                  {avatar
                    ? "Assign a device to this avatar to see details"
                    : "Choose an avatar from the list to view its device"}
                </p>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function DeviceMockup({ device }: { device: AvatarWithRelations["device"] }) {
  return (
    <div className="w-full max-w-[200px]">
      <div
        className={cn(
          "relative flex aspect-[9/19] w-full flex-col overflow-hidden rounded-[1.8rem] border-[3px] bg-card shadow-lg",
          device ? "border-foreground/15" : "border-muted-foreground/10"
        )}
      >
        <div className="absolute left-1/2 top-[6px] z-10 h-[14px] w-[60px] -translate-x-1/2 rounded-full bg-foreground/8" />
        <div className="flex flex-1 items-center justify-center bg-gradient-to-b from-muted/20 to-muted/40 pt-6">
          {device ? (
            <div className="flex flex-col items-center gap-1.5 px-3 text-center">
              <Monitor className="h-5 w-5 text-muted-foreground/30" />
              <p className="text-[9px] leading-tight text-muted-foreground/50">
                Streaming available in a future update
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 px-3 text-center">
              <Smartphone className="h-5 w-5 text-muted-foreground/20" />
              <p className="text-[9px] text-muted-foreground/30">No device</p>
            </div>
          )}
        </div>
        <div className="flex h-8 shrink-0 items-center justify-center gap-5 border-t border-foreground/5 bg-card">
          <div className="h-[5px] w-[5px] rounded-[1px] border border-foreground/12" />
          <div className="h-[7px] w-[7px] rounded-full border border-foreground/12" />
          <div className="h-0 w-0 border-x-[4px] border-b-[5px] border-x-transparent border-b-foreground/12" />
        </div>
      </div>
    </div>
  );
}
