"use client";

import { useEffect, useRef } from "react";

interface UseInfiniteScrollOptions {
  /** When `false`, the observer is disconnected (no auto-load). */
  enabled: boolean;
  /** Called when the sentinel intersects the scroll container's viewport. */
  onLoadMore: () => void;
  /** Distance from the bottom (in px) at which to start loading more. */
  rootMargin?: string;
}

/**
 * Triggers `onLoadMore` when the returned ref (a sentinel element placed at
 * the bottom of a list) intersects its closest scrolling ancestor.
 *
 * Works seamlessly inside the project's `<ScrollArea>` component by walking
 * up the DOM to the viewport (`[data-slot="scroll-area-viewport"]`). When no
 * such ancestor exists, the observer falls back to the browser viewport.
 *
 * The `onLoadMore` callback is read through a ref so that callers don't need
 * to memoize it — the observer never re-installs on identity changes.
 */
export function useInfiniteScroll<T extends HTMLElement = HTMLDivElement>({
  enabled,
  onLoadMore,
  rootMargin = "200px",
}: UseInfiniteScrollOptions) {
  const sentinelRef = useRef<T | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    if (!enabled) return;

    const node = sentinelRef.current;
    if (!node) return;

    const root = node.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onLoadMoreRef.current();
      },
      { root, rootMargin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, rootMargin]);

  return sentinelRef;
}
