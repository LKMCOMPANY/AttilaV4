"use client";

import { useEffect, useState } from "react";

/**
 * Reports whether an element is worth rendering an expensive animation for:
 * it must be BOTH intersecting the viewport AND on the foreground browser tab.
 *
 * Drives pausing the WebGL render loop for the 3D map when it scrolls off,
 * the operator switches to another panel, or the tab is backgrounded — the
 * single biggest GPU/battery win for a continuously-animating canvas.
 *
 * Returns `true` until the observer has measured (so first paint isn't gated),
 * then converges to the real visibility.
 */
export function useActiveViewport(
  ref: React.RefObject<HTMLElement | null>,
): boolean {
  const [inView, setInView] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? true),
      { rootMargin: "120px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  useEffect(() => {
    const onChange = () => setTabVisible(document.visibilityState !== "hidden");
    onChange();
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return inView && tabVisible;
}
