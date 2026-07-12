"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

/**
 * Reactive `prefers-reduced-motion` reader. `useSyncExternalStore` keeps it
 * SSR-safe (server snapshot is `false`) and free of the `set-state-in-effect`
 * pattern the React 19 lint flags. Use it to drop non-essential motion —
 * auto-rotation, particle flows — for users who ask the OS to reduce motion.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
