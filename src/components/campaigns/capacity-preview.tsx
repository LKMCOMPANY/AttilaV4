"use client";

import { BarChart3 } from "lucide-react";

interface CapacityPreviewProps {
  totalAvatars: number;
  armyCount: number;
}

export function CapacityPreview({ totalAvatars, armyCount }: CapacityPreviewProps) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Capacity Preview
        </p>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div>
          <p className="text-lg font-semibold tabular-nums">{totalAvatars}</p>
          <p className="text-[10px] text-muted-foreground">Avatars selected</p>
        </div>
        <div>
          <p className="text-lg font-semibold tabular-nums">{armyCount}</p>
          <p className="text-[10px] text-muted-foreground">
            {armyCount === 1 ? "Army" : "Armies"}
          </p>
        </div>
      </div>
      {totalAvatars === 0 && armyCount === 0 && (
        <p className="mt-2 text-[10px] text-muted-foreground/60">
          Select armies above to see capacity estimates
        </p>
      )}
    </div>
  );
}
