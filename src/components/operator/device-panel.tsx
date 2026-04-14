"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
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
  Loader2,
  Play,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceStream, type UseDeviceStreamReturn } from "@/hooks/use-device-stream";
import { isWebCodecsSupported, type StreamStatus } from "@/lib/streaming/scrcpy-stream";
import { StreamCanvas } from "./stream-canvas";
import { ScreenshotViewer } from "./screenshot-viewer";
import { StreamStatusBar } from "./stream-status";
import { NavBar } from "./nav-bar";
import {
  toggleScreenWake,
  startContainer,
  stopContainer,
} from "@/app/actions/device-control";
import { toast } from "sonner";
import type { AvatarWithRelations } from "@/types";
import type { StreamMode } from "@/lib/streaming/types";

interface DevicePanelProps {
  avatar: AvatarWithRelations | null;
}

export function DevicePanel({ avatar }: DevicePanelProps) {
  const device = avatar?.device;
  const serverState = device?.state;

  const [optimisticState, setOptimisticState] = useState<string | null>(null);
  const deviceState = optimisticState ?? serverState;
  const isRunning = deviceState === "running";

  useEffect(() => {
    setOptimisticState(null);
  }, [serverState]);

  const [webCodecs] = useState(() =>
    typeof window !== "undefined" ? isWebCodecsSupported() : true
  );
  const [mode, setMode] = useState<StreamMode>(() =>
    webCodecs ? "stream" : "screenshot"
  );
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const { status, error, canvasRef, handlers, sendKeycode } = useDeviceStream({
    boxId: device?.box_id ?? null,
    dbId: device?.db_id ?? null,
    enabled: isRunning && mode === "stream" && webCodecs,
  });

  useEffect(() => {
    if (!webCodecs) setMode("screenshot");
  }, [webCodecs]);

  const handleWake = useCallback(async () => {
    if (!device) return;
    setActionLoading("wake");
    await toggleScreenWake(device.id);
    setActionLoading(null);
  }, [device]);

  const handlePower = useCallback(async () => {
    if (!device) return;
    setActionLoading("power");
    if (isRunning) {
      setOptimisticState("stopped");
      await stopContainer(device.id);
    } else {
      setOptimisticState("running");
      await startContainer(device.id);
    }
    setActionLoading(null);
  }, [device, isRunning]);

  const handleDownloadScreenshot = useCallback(async () => {
    if (!device) return;
    try {
      const url = `/api/box/${device.box_id}/container_api/v1/screenshots/${device.db_id}?t=${Date.now()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Screenshot unavailable");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${device.user_name || device.db_id}_${Date.now()}.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      toast.error("Failed to download screenshot");
    }
  }, [device]);

  const handleExtractText = useCallback(async () => {
    if (!device) return;
    setActionLoading("extract");
    try {
      const url = `/api/box/${device.box_id}/container_api/v1/screenshots/${device.db_id}?t=${Date.now()}`;
      const Tesseract = await import("tesseract.js");
      const { data: { text } } = await Tesseract.default.recognize(url, "eng+fra");
      const cleaned = text.trim();
      if (cleaned) {
        await navigator.clipboard.writeText(cleaned);
        toast.success("Text copied to clipboard", {
          description: cleaned.length > 100 ? cleaned.slice(0, 100) + "..." : cleaned,
        });
      } else {
        toast.info("No text found in screenshot");
      }
    } catch {
      toast.error("Text extraction failed");
    }
    setActionLoading(null);
  }, [device]);

  const handleDetach = useCallback(() => {
    if (!device) return;
    const w = 400;
    const h = Math.round(w * (19 / 9));
    const left = window.screenX + window.outerWidth;
    const top = window.screenY;
    window.open(
      `/dashboard/stream/${device.id}`,
      `stream-${device.id}`,
      `width=${w},height=${h},left=${left},top=${top}`
    );
  }, [device]);

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
                  disabled={!device || !isRunning || actionLoading === "wake"}
                  onClick={handleWake}
                />
              }
            >
              {actionLoading === "wake" ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                <Sun className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="hidden @[280px]/device:inline">
                Sleep / Awake
              </span>
            </TooltipTrigger>
            <TooltipContent>Sleep / Awake</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-7 gap-1.5 px-2 text-[11px] @[280px]/device:px-2.5",
                    isRunning &&
                      "hover:border-destructive/40 hover:text-destructive"
                  )}
                  disabled={!device || actionLoading === "power"}
                  onClick={handlePower}
                />
              }
            >
              {actionLoading === "power" ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                <Power className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="hidden @[280px]/device:inline">
                {isRunning ? "Stop" : "Start"}
              </span>
            </TooltipTrigger>
            <TooltipContent>{isRunning ? "Stop device" : "Start device"}</TooltipContent>
          </Tooltip>
        </div>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-[11px]"
                disabled={!device || !isRunning}
                onClick={handleDetach}
              />
            }
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden @[280px]/device:inline">Detach</span>
          </TooltipTrigger>
          <TooltipContent>Open in new window</TooltipContent>
        </Tooltip>
      </div>

      {/* Device mockup */}
      <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden p-4">
        <div
          className="pointer-events-none absolute inset-0 z-0 opacity-[0.35] dark:opacity-[0.18]"
          style={{
            backgroundImage: "radial-gradient(circle at 50% 50%, var(--foreground) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
            maskImage: "radial-gradient(ellipse 80% 70% at 50% 50%, black 20%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 50% 50%, black 20%, transparent 100%)",
          }}
          aria-hidden="true"
        />
        <div className="w-full max-w-[320px]">
          <div
            className={cn(
              "relative flex aspect-[9/19] w-full flex-col overflow-hidden rounded-[2rem] border-[3px]",
              "bg-white dark:bg-card",
              "shadow-[0_8px_30px_-4px_rgba(0,0,0,0.25),0_2px_8px_-2px_rgba(0,0,0,0.15)]",
              "dark:shadow-[0_4px_30px_0px_rgba(255,255,255,0.08),0_0_15px_0px_rgba(255,255,255,0.05)]",
              device && isRunning
                ? "border-border dark:border-foreground/15"
                : device
                  ? "border-border dark:border-muted-foreground/15"
                  : "border-border/60 dark:border-muted-foreground/10"
            )}
          >
            {/* Notch */}
            <div className="absolute left-1/2 top-[6px] z-10 h-[14px] w-[60px] -translate-x-1/2 rounded-full bg-foreground/8" />

            {/* Screen area */}
            <div className="flex flex-1 flex-col overflow-hidden bg-black pt-6">
              <DeviceScreen
                device={device}
                avatar={avatar}
                isRunning={isRunning}
                mode={mode}
                webCodecs={webCodecs}
                canvasRef={canvasRef}
                streamStatus={status}
                handlers={handlers}
                actionLoading={actionLoading}
                onStart={handlePower}
              />
            </div>

            {/* Nav bar */}
            <NavBar isStreaming={status === "streaming"} sendKeycode={sendKeycode} />
          </div>
        </div>

        {/* Status bar below mockup */}
        {device && isRunning && (
          <div className="mt-2 w-full max-w-[320px]">
            <StreamStatusBar
              status={status}
              error={error}
              mode={mode}
              onModeChange={setMode}
              webCodecsSupported={webCodecs}
              onDownload={handleDownloadScreenshot}
              onExtractText={handleExtractText}
              extractLoading={actionLoading === "extract"}
            />
          </div>
        )}

        {/* Empty state text */}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen content — switches between stream, screenshot, and placeholders
// ---------------------------------------------------------------------------

function DeviceScreen({
  device,
  avatar,
  isRunning,
  mode,
  webCodecs,
  canvasRef,
  streamStatus,
  handlers,
  actionLoading,
  onStart,
}: {
  device: AvatarWithRelations["device"];
  avatar: AvatarWithRelations | null;
  isRunning: boolean | undefined;
  mode: StreamMode;
  webCodecs: boolean;
  canvasRef: UseDeviceStreamReturn["canvasRef"];
  streamStatus: StreamStatus;
  handlers: UseDeviceStreamReturn["handlers"];
  actionLoading: string | null;
  onStart: () => void;
}) {
  if (!device) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-1.5 px-3 text-center">
          <Smartphone className="h-5 w-5 text-muted-foreground/20" />
          <p className="text-[9px] text-muted-foreground/30">
            {avatar ? "No device" : "Select an avatar"}
          </p>
        </div>
      </div>
    );
  }

  if (!isRunning) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-2 px-3 text-center">
          <WifiOff className="h-5 w-5 text-muted-foreground/30" />
          <p className="text-[9px] leading-tight text-muted-foreground/50">
            Device offline
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-1 h-6 gap-1 px-2.5 text-[10px]"
            disabled={actionLoading === "power"}
            onClick={onStart}
          >
            {actionLoading === "power" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            Start
          </Button>
        </div>
      </div>
    );
  }

  if (mode === "stream" && webCodecs) {
    return (
      <StreamCanvas
        canvasRef={canvasRef}
        status={streamStatus}
        handlers={handlers}
        className="flex-1"
      />
    );
  }

  return (
    <ScreenshotViewer
      boxId={device.box_id}
      dbId={device.db_id}
      deviceId={device.id}
      resolution={device.resolution}
      interval={800}
      className="flex-1"
    />
  );
}

