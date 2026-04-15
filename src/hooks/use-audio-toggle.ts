"use client";

import { useState, useCallback } from "react";
import { enableDeviceAudio } from "@/app/actions/device-control";

/**
 * Shared hook for the audio enable/toggle pattern.
 * On first enable, starts the scrcpy audio process on the device,
 * then toggles the stream. Subsequent toggles skip the server call.
 */
export function useAudioToggle(
  deviceId: string | null | undefined,
  audioEnabled: boolean,
  toggleAudio: () => void
) {
  const [audioReady, setAudioReady] = useState(false);

  const handleToggleAudio = useCallback(async () => {
    if (!audioEnabled && deviceId && !audioReady) {
      await enableDeviceAudio(deviceId);
      setAudioReady(true);
      toggleAudio();
    } else {
      toggleAudio();
    }
  }, [audioEnabled, deviceId, audioReady, toggleAudio]);

  return handleToggleAudio;
}
