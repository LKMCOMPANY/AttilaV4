"use client";

import { useCallback } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACTION_DOWN, ACTION_UP } from "@/lib/streaming/scrcpy-stream";
import { KEYCODE_BACK, KEYCODE_HOME, KEYCODE_APP_SWITCH } from "@/lib/streaming/scrcpy-codec";
import type { AudioPlayerStatus } from "@/lib/streaming/audio-player";

interface NavBarProps {
  isStreaming: boolean;
  sendKeycode: (action: number, keycode: number) => void;
  audioEnabled?: boolean;
  audioStatus?: AudioPlayerStatus;
  onToggleAudio?: () => void;
}

export function NavBar({
  isStreaming,
  sendKeycode,
  audioEnabled = false,
  audioStatus = "idle",
  onToggleAudio,
}: NavBarProps) {
  const tap = useCallback(
    (keycode: number) => {
      sendKeycode(ACTION_DOWN, keycode);
      sendKeycode(ACTION_UP, keycode);
    },
    [sendKeycode]
  );

  const btnClass = cn(
    "flex items-center justify-center transition-colors",
    isStreaming
      ? "cursor-pointer hover:bg-white/10 active:bg-white/15"
      : "cursor-default opacity-40"
  );

  const audioActive = audioEnabled && audioStatus === "playing";
  const audioConnecting = audioEnabled && audioStatus === "connecting";

  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-t border-white/5 bg-black px-3">
      {/* Audio toggle */}
      <button
        type="button"
        className={cn(
          "flex items-center justify-center rounded px-2 py-1 transition-colors",
          isStreaming
            ? "cursor-pointer hover:bg-white/10 active:bg-white/15"
            : "cursor-default opacity-40"
        )}
        disabled={!isStreaming}
        onClick={onToggleAudio}
        aria-label={audioEnabled ? "Disable audio" : "Enable audio"}
      >
        {audioEnabled ? (
          <Volume2
            className={cn(
              "h-3.5 w-3.5 transition-colors",
              audioActive
                ? "text-emerald-400"
                : audioConnecting
                  ? "text-amber-400 animate-pulse"
                  : "text-white/50"
            )}
          />
        ) : (
          <VolumeX className="h-3.5 w-3.5 text-white/25" />
        )}
      </button>

      {/* Navigation buttons */}
      <div className="flex items-center gap-6">
        <button
          type="button"
          className={cn(btnClass, "h-full w-11")}
          disabled={!isStreaming}
          onClick={() => tap(KEYCODE_APP_SWITCH)}
          aria-label="Recent apps"
        >
          <div className="h-[7px] w-[7px] rounded-[1.5px] border-[1.5px] border-white/30" />
        </button>
        <button
          type="button"
          className={cn(btnClass, "h-full w-11")}
          disabled={!isStreaming}
          onClick={() => tap(KEYCODE_HOME)}
          aria-label="Home"
        >
          <div className="h-[9px] w-[9px] rounded-full border-[1.5px] border-white/30" />
        </button>
        <button
          type="button"
          className={cn(btnClass, "h-full w-11")}
          disabled={!isStreaming}
          onClick={() => tap(KEYCODE_BACK)}
          aria-label="Back"
        >
          <div className="h-0 w-0 border-x-[5px] border-b-[7px] border-x-transparent border-b-white/30" />
        </button>
      </div>

      {/* Spacer for visual balance */}
      <div className="w-[30px]" />
    </div>
  );
}
