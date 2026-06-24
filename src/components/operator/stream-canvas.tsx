"use client";

import { Loader2 } from "lucide-react";
import type { StreamStatus } from "@/lib/streaming/scrcpy-stream";
import { cn } from "@/lib/utils";

// Pre-live states share one calm overlay so the operator sees a single steady
// progression (Starting device -> Connecting -> Live) instead of flicker.
const PENDING_LABELS: Partial<Record<StreamStatus, string>> = {
  starting: "Starting device",
  connecting: "Connecting",
  reconnecting: "Reconnecting",
};

interface StreamCanvasProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  status: StreamStatus;
  handlers: {
    onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
    onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
    onMouseUp: (e: React.MouseEvent<HTMLCanvasElement>) => void;
    onMouseLeave: (e: React.MouseEvent<HTMLCanvasElement>) => void;
    onTouchStart: (e: React.TouchEvent<HTMLCanvasElement>) => void;
    onTouchMove: (e: React.TouchEvent<HTMLCanvasElement>) => void;
    onTouchEnd: (e: React.TouchEvent<HTMLCanvasElement>) => void;
    onWheel: (e: React.WheelEvent<HTMLCanvasElement>) => void;
  };
  className?: string;
}

export function StreamCanvas({
  canvasRef,
  status,
  handlers,
  className,
}: StreamCanvasProps) {
  return (
    <div className={cn("relative flex-1 overflow-hidden", className)}>
      <canvas
        ref={canvasRef}
        className={cn(
          "h-full w-full object-contain outline-none",
          status === "streaming" ? "cursor-crosshair" : "cursor-default"
        )}
        style={{ touchAction: "none" }}
        {...handlers}
      />
      {PENDING_LABELS[status] && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-[10px] font-medium text-muted-foreground">
            {PENDING_LABELS[status]}
          </span>
        </div>
      )}
    </div>
  );
}
