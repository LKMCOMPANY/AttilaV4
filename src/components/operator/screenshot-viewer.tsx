"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { shellTap } from "@/app/actions/device-control";
import { cn } from "@/lib/utils";

interface ScreenshotViewerProps {
  boxId: string;
  dbId: string;
  deviceId: string;
  resolution: string | null;
  interval?: number;
  className?: string;
}

export function ScreenshotViewer({
  boxId,
  dbId,
  deviceId,
  resolution,
  interval = 800,
  className,
}: ScreenshotViewerProps) {
  const [src, setSrc] = useState<string>("");
  const bufferRef = useRef<HTMLImageElement | null>(null);

  const screenshotUrl = `/api/box/${boxId}/container_api/v1/screenshots/${dbId}`;

  useEffect(() => {
    let mounted = true;

    function refresh() {
      if (!mounted) return;

      if (bufferRef.current) {
        bufferRef.current.onload = null;
        bufferRef.current.src = "";
      }

      const img = new Image();
      img.onload = () => {
        if (mounted) setSrc(img.src);
      };
      img.onerror = () => {
        if (mounted) setSrc("");
      };
      img.src = `${screenshotUrl}?t=${Date.now()}`;
      bufferRef.current = img;
    }

    refresh();
    const timer = setInterval(refresh, interval);
    return () => {
      mounted = false;
      clearInterval(timer);
      if (bufferRef.current) {
        bufferRef.current.onload = null;
        bufferRef.current.src = "";
        bufferRef.current = null;
      }
    };
  }, [screenshotUrl, interval]);

  const [w, h] = (resolution ?? "1080x2340").split("x").map(Number);

  const handleClick = useCallback(
    async (e: React.MouseEvent<HTMLImageElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.round(((e.clientX - rect.left) / rect.width) * w);
      const y = Math.round(((e.clientY - rect.top) / rect.height) * h);
      await shellTap(deviceId, x, y);
    },
    [deviceId, w, h]
  );

  if (!src) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-black",
          className
        )}
      >
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt="Device screen"
      className={cn("h-full w-full cursor-crosshair object-contain", className)}
      onClick={handleClick}
      draggable={false}
    />
  );
}
