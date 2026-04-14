"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AvatarWithRelations } from "@/types";

interface DevicePanelProps {
  avatar: AvatarWithRelations | null;
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

      {/* Mockup */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col items-center justify-center p-4">
          <DeviceMockup device={device} />
          {!device && (
            <div className="mt-6 text-center">
              <p className="text-sm font-medium text-muted-foreground">
                {avatar ? "No device assigned" : "Select an avatar"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground/60">
                {avatar
                  ? "Assign a device to this avatar"
                  : "Choose an avatar from the list"}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function DeviceMockup({ device }: { device: AvatarWithRelations["device"] }) {
  return (
    <div className="w-full max-w-[280px]">
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
