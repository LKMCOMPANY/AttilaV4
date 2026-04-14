"use client";

import { Loader2 } from "lucide-react";
import type { StreamStatus } from "@/lib/streaming/scrcpy-stream";
import { cn } from "@/lib/utils";

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
      {status === "connecting" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
