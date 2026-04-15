"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ScrcpyStream,
  ACTION_DOWN,
  ACTION_UP,
  ACTION_MOVE,
  type StreamStatus,
} from "@/lib/streaming/scrcpy-stream";
import { ANDROID_KEYCODES, META_CTRL, META_SHIFT, META_ALT } from "@/lib/streaming/scrcpy-codec";
import { AudioPlayer, type AudioPlayerStatus } from "@/lib/streaming/audio-player";

interface UseDeviceStreamOptions {
  boxId: string | null;
  dbId: string | null;
  enabled: boolean;
}

export interface UseDeviceStreamReturn {
  status: StreamStatus;
  error: string | null;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
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
  sendKeycode: (action: number, keycode: number, metastate?: number) => void;
  sendText: (text: string) => void;
  sendClipboard: (text: string) => void;
  audioStatus: AudioPlayerStatus;
  audioEnabled: boolean;
  toggleAudio: () => void;
}

function buildWsUrl(boxId: string, dbId: string, type: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/stream/${boxId}/${dbId}/${type}`;
}

export function useDeviceStream({
  boxId,
  dbId,
  enabled,
}: UseDeviceStreamOptions): UseDeviceStreamReturn {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<ScrcpyStream | null>(null);
  const audioRef = useRef<AudioPlayer | null>(null);
  const pointerDown = useRef(false);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [audioStatus, setAudioStatus] = useState<AudioPlayerStatus>("idle");
  const [audioEnabled, setAudioEnabled] = useState(false);

  // -------------------------------------------------------------------------
  // Video stream lifecycle
  // -------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!enabled || !boxId || !dbId || !canvas) {
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      setStatus("idle");
      setError(null);
      return;
    }

    setError(null);

    const stream = new ScrcpyStream({
      videoUrl: buildWsUrl(boxId, dbId, "video"),
      controlUrl: buildWsUrl(boxId, dbId, "touch"),
      canvas,
      onStatus: setStatus,
      onError: setError,
    });

    streamRef.current = stream;
    stream.start();

    return () => {
      streamRef.current = null;
      stream.dispose();
    };
  }, [boxId, dbId, enabled]);

  // -------------------------------------------------------------------------
  // Audio stream lifecycle
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!audioEnabled || !boxId || !dbId || !enabled) {
      audioRef.current?.dispose();
      audioRef.current = null;
      setAudioStatus("idle");
      return;
    }

    const player = new AudioPlayer({
      url: buildWsUrl(boxId, dbId, "audio"),
      onStatus: setAudioStatus,
      onError: (msg) => setError((prev) => prev ?? `Audio: ${msg}`),
    });

    audioRef.current = player;
    player.start();

    return () => {
      audioRef.current = null;
      player.dispose();
    };
  }, [boxId, dbId, enabled, audioEnabled]);

  const toggleAudio = useCallback(() => {
    setAudioEnabled((prev) => !prev);
  }, []);

  // -------------------------------------------------------------------------
  // Keyboard input (when canvas is focused)
  // -------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || status !== "streaming") return;

    canvas.tabIndex = 0;
    canvas.focus();

    function getMetastate(e: KeyboardEvent): number {
      let meta = 0;
      if (e.shiftKey) meta |= META_SHIFT;
      if (e.ctrlKey || e.metaKey) meta |= META_CTRL;
      if (e.altKey) meta |= META_ALT;
      return meta;
    }

    function handleKeyDown(e: KeyboardEvent) {
      const stream = streamRef.current;
      if (!stream) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "v") {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => {
          if (!text || !streamRef.current) return;
          streamRef.current.sendClipboard(text);
          setTimeout(() => {
            streamRef.current?.sendKeycode(ACTION_DOWN, 50, META_CTRL);
            streamRef.current?.sendKeycode(ACTION_UP, 50, META_CTRL);
          }, 50);
        }).catch(() => {});
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        e.preventDefault();
        stream.sendKeycode(ACTION_DOWN, 31, META_CTRL);
        stream.sendKeycode(ACTION_UP, 31, META_CTRL);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        stream.sendKeycode(ACTION_DOWN, 29, META_CTRL);
        stream.sendKeycode(ACTION_UP, 29, META_CTRL);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "x") {
        e.preventDefault();
        stream.sendKeycode(ACTION_DOWN, 52, META_CTRL);
        stream.sendKeycode(ACTION_UP, 52, META_CTRL);
        return;
      }

      const androidKeycode = ANDROID_KEYCODES[e.key];
      if (androidKeycode !== undefined) {
        e.preventDefault();
        stream.sendKeycode(ACTION_DOWN, androidKeycode, getMetastate(e));
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        stream.sendText(e.key);
      }
    }

    function handleKeyUp(e: KeyboardEvent) {
      const stream = streamRef.current;
      if (!stream) return;

      const androidKeycode = ANDROID_KEYCODES[e.key];
      if (androidKeycode !== undefined) {
        e.preventDefault();
        stream.sendKeycode(ACTION_UP, androidKeycode, getMetastate(e));
      }
    }

    canvas.addEventListener("keydown", handleKeyDown);
    canvas.addEventListener("keyup", handleKeyUp);

    return () => {
      canvas.removeEventListener("keydown", handleKeyDown);
      canvas.removeEventListener("keyup", handleKeyUp);
      canvas.tabIndex = -1;
    };
  }, [status]);

  // -------------------------------------------------------------------------
  // Touch coordinate mapping
  // -------------------------------------------------------------------------

  const toDeviceCoords = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => {
      const stream = streamRef.current;
      if (!stream || !stream.videoWidth) return null;
      const x = ((clientX - rect.left) / rect.width) * stream.videoWidth;
      const y = ((clientY - rect.top) / rect.height) * stream.videoHeight;
      return { x, y };
    },
    []
  );

  // -------------------------------------------------------------------------
  // Mouse handlers
  // -------------------------------------------------------------------------

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      pointerDown.current = true;
      const coords = toDeviceCoords(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
      if (coords) streamRef.current?.sendTouch(ACTION_DOWN, coords.x, coords.y);
    },
    [toDeviceCoords]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!pointerDown.current) return;
      const coords = toDeviceCoords(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
      if (coords) streamRef.current?.sendTouch(ACTION_MOVE, coords.x, coords.y);
    },
    [toDeviceCoords]
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      pointerDown.current = false;
      const coords = toDeviceCoords(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
      if (coords) streamRef.current?.sendTouch(ACTION_UP, coords.x, coords.y);
    },
    [toDeviceCoords]
  );

  // -------------------------------------------------------------------------
  // Touch handlers
  // -------------------------------------------------------------------------

  const onTouchStart = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const touch = e.touches[0];
      const coords = toDeviceCoords(touch.clientX, touch.clientY, e.currentTarget.getBoundingClientRect());
      if (coords) streamRef.current?.sendTouch(ACTION_DOWN, coords.x, coords.y);
    },
    [toDeviceCoords]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      const touch = e.touches[0];
      const coords = toDeviceCoords(touch.clientX, touch.clientY, e.currentTarget.getBoundingClientRect());
      if (coords) streamRef.current?.sendTouch(ACTION_MOVE, coords.x, coords.y);
    },
    [toDeviceCoords]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      const touch = e.changedTouches[0];
      const coords = toDeviceCoords(touch.clientX, touch.clientY, e.currentTarget.getBoundingClientRect());
      if (coords) streamRef.current?.sendTouch(ACTION_UP, coords.x, coords.y);
    },
    [toDeviceCoords]
  );

  // -------------------------------------------------------------------------
  // Wheel handler (scroll)
  // -------------------------------------------------------------------------

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const coords = toDeviceCoords(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
      if (!coords) return;
      const hscroll = e.deltaX > 0 ? -1 : e.deltaX < 0 ? 1 : 0;
      const vscroll = e.deltaY > 0 ? -1 : e.deltaY < 0 ? 1 : 0;
      streamRef.current?.sendScroll(coords.x, coords.y, hscroll, vscroll);
    },
    [toDeviceCoords]
  );

  // -------------------------------------------------------------------------
  // Exposed control methods
  // -------------------------------------------------------------------------

  const sendKeycode = useCallback(
    (action: number, keycode: number, metastate: number = 0) => {
      streamRef.current?.sendKeycode(action, keycode, metastate);
    },
    []
  );

  const sendText = useCallback((text: string) => {
    streamRef.current?.sendText(text);
  }, []);

  const sendClipboard = useCallback((text: string) => {
    streamRef.current?.sendClipboard(text);
  }, []);

  return {
    status,
    error,
    canvasRef,
    handlers: {
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onMouseLeave: onMouseUp,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onWheel,
    },
    sendKeycode,
    sendText,
    sendClipboard,
    audioStatus,
    audioEnabled,
    toggleAudio,
  };
}
