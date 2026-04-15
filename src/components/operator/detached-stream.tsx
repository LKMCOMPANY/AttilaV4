"use client";

import { useEffect } from "react";
import { useDeviceStream } from "@/hooks/use-device-stream";
import { useAudioToggle } from "@/hooks/use-audio-toggle";
import { isWebCodecsSupported } from "@/lib/streaming/scrcpy-stream";
import { StreamCanvas } from "./stream-canvas";
import { NavBar } from "./nav-bar";

interface DetachedStreamProps {
  boxId: string;
  dbId: string;
  deviceName: string;
  deviceId?: string;
}

export function DetachedStream({ boxId, dbId, deviceName, deviceId }: DetachedStreamProps) {
  const {
    status,
    canvasRef,
    handlers,
    sendKeycode,
    audioEnabled,
    audioStatus,
    toggleAudio,
  } = useDeviceStream({
    boxId,
    dbId,
    enabled: isWebCodecsSupported(),
  });

  const handleToggleAudio = useAudioToggle(deviceId, audioEnabled, toggleAudio);

  useEffect(() => {
    document.title = `${deviceName} — Stream`;
  }, [deviceName]);

  return (
    <div className="flex h-dvh w-dvw flex-col bg-black">
      <StreamCanvas
        canvasRef={canvasRef}
        status={status}
        handlers={handlers}
        className="flex-1"
      />
      <NavBar
        isStreaming={status === "streaming"}
        sendKeycode={sendKeycode}
        audioEnabled={audioEnabled}
        audioStatus={audioStatus}
        onToggleAudio={handleToggleAudio}
      />
    </div>
  );
}
