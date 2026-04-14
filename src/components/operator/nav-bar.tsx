"use client";

import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { ACTION_DOWN, ACTION_UP } from "@/lib/streaming/scrcpy-stream";
import { KEYCODE_BACK, KEYCODE_HOME, KEYCODE_APP_SWITCH } from "@/lib/streaming/scrcpy-codec";

interface NavBarProps {
  isStreaming: boolean;
  sendKeycode: (action: number, keycode: number) => void;
}

export function NavBar({ isStreaming, sendKeycode }: NavBarProps) {
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

  return (
    <div className="flex h-9 shrink-0 items-center justify-center gap-6 border-t border-white/5 bg-black">
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
  );
}
