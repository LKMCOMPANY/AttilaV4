"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface NetworkMapSkeletonProps {
  className?: string;
}

export function NetworkMapSkeleton({ className }: NetworkMapSkeletonProps) {
  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden bg-background",
        className
      )}
    >
      {/* Header skeleton */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-border/50 p-3 glass-effect">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-14 rounded-full" />
        </div>
        <div className="flex items-center gap-1">
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-md" />
        </div>
      </div>

      {/* Central animation */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative h-28 w-28">
          <Skeleton className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full" />

          <div
            className="absolute inset-0 animate-spin"
            style={{ animationDuration: "8s" }}
          >
            <Skeleton className="absolute left-1/2 top-0 h-4 w-4 -translate-x-1/2 rounded-full" />
            <Skeleton className="absolute bottom-0 left-1/2 h-4 w-4 -translate-x-1/2 rounded-full" />
            <Skeleton className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full" />
            <Skeleton className="absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full" />
          </div>

          <div
            className="absolute -inset-4 animate-spin"
            style={{ animationDuration: "12s", animationDirection: "reverse" }}
          >
            <Skeleton className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 rounded-full opacity-50" />
            <Skeleton className="absolute bottom-0 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full opacity-50" />
            <Skeleton className="absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full opacity-50" />
            <Skeleton className="absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full opacity-50" />
          </div>
        </div>
      </div>

      {/* Legend skeleton */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-5 border-t border-border/50 px-4 py-2 glass-effect">
        {[16, 12, 14].map((w, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Skeleton className="h-2.5 w-2.5 rounded-full" />
            <Skeleton className="h-3" style={{ width: `${w * 4}px` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
