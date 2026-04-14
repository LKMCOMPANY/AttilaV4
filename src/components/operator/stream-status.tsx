"use client";

import { cn } from "@/lib/utils";
import { ScanText, Download, Loader2 } from "lucide-react";
import type { StreamStatus } from "@/lib/streaming/scrcpy-stream";
import type { StreamMode } from "@/lib/streaming/types";

interface StreamStatusBarProps {
  status: StreamStatus;
  error: string | null;
  mode: StreamMode;
  onModeChange: (mode: StreamMode) => void;
  webCodecsSupported: boolean;
  onExtractText?: () => void;
  extractLoading?: boolean;
  onDownload?: () => void;
}

const STATUS_CONFIG: Record<
  StreamStatus,
  { label: string; dotClass: string }
> = {
  idle: { label: "Idle", dotClass: "bg-muted-foreground" },
  connecting: {
    label: "Connecting...",
    dotClass: "bg-warning animate-pulse",
  },
  streaming: { label: "Live", dotClass: "bg-success" },
  disconnected: { label: "Disconnected", dotClass: "bg-muted-foreground" },
  error: { label: "Error", dotClass: "bg-destructive" },
};

export function StreamStatusBar({
  status,
  error,
  mode,
  onModeChange,
  webCodecsSupported,
  onExtractText,
  extractLoading,
  onDownload,
}: StreamStatusBarProps) {
  const config = STATUS_CONFIG[status];

  return (
    <div className="flex items-center justify-between px-2 py-1">
      <div className="flex items-center gap-1.5">
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", config.dotClass)}
        />
        <span className="text-[10px] text-muted-foreground">
          {error ?? config.label}
        </span>
      </div>

      <div className="flex items-center gap-0.5">
        {mode === "screenshot" && (
          <>
            {onDownload && (
              <button
                onClick={onDownload}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-primary/15 hover:text-primary"
              >
                <Download className="h-3 w-3" />
              </button>
            )}
            {onExtractText && (
              <button
                onClick={onExtractText}
                disabled={extractLoading}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                  "text-muted-foreground hover:bg-primary/15 hover:text-primary",
                  extractLoading && "pointer-events-none opacity-60"
                )}
              >
                {extractLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ScanText className="h-3 w-3" />
                )}
                Extract
              </button>
            )}
          </>
        )}

        <button
          onClick={() => onModeChange("stream")}
          disabled={!webCodecsSupported}
          className={cn(
            "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
            mode === "stream"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground",
            !webCodecsSupported && "cursor-not-allowed opacity-40"
          )}
        >
          Stream
        </button>
        <button
          onClick={() => onModeChange("screenshot")}
          className={cn(
            "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
            mode === "screenshot"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Screenshot
        </button>
      </div>
    </div>
  );
}
