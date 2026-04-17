"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Loader2, Radio, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAccountZones, type AccountZone } from "@/app/actions/campaigns";
import type { StepProps } from "../types";

export function StepZone({ data, onChange, accountId }: StepProps) {
  const [zones, setZones] = useState<AccountZone[]>([]);
  const [loading, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    startTransition(async () => {
      try {
        const result = await getAccountZones(accountId);
        setZones(result);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load zones");
      }
    });
  }, [accountId]);

  // Live (push enabled) zones float to the top of the list — that's where
  // a campaign can actually receive data.
  const sortedZones = useMemo(
    () =>
      [...zones].sort((a, b) => {
        if (a.push_enabled !== b.push_enabled) return a.push_enabled ? -1 : 1;
        return a.zone_name.localeCompare(b.zone_name);
      }),
    [zones],
  );

  const handleSelect = (zone: AccountZone) => {
    onChange({
      gorgone_zone_id: zone.zone_id,
      gorgone_zone_name: zone.zone_name,
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading zones...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (zones.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="rounded-full bg-muted p-3">
          <Radio className="h-5 w-5 text-muted-foreground/50" />
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            No Gorgone zones available
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground/60">
            Ask an admin to link a Gorgone client to this account
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-1">
      <div className="space-y-1">
        <Label>Select Data Source Zone</Label>
        <p className="text-xs text-muted-foreground">
          Choose the Gorgone zone that will feed posts to this campaign
        </p>
      </div>

      <div className="space-y-2">
        {sortedZones.map((zone) => {
          const isSelected = data.gorgone_zone_id === zone.zone_id;
          return (
            <button
              key={zone.zone_id}
              type="button"
              onClick={() => handleSelect(zone)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/30 hover:bg-muted/50",
                !zone.push_enabled && !isSelected && "opacity-70"
              )}
            >
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                  isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                )}
              >
                <Radio className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{zone.zone_name}</p>
                  <Badge
                    variant={zone.push_enabled ? "secondary" : "outline"}
                    className={cn(
                      "h-4 shrink-0 px-1.5 text-[9px] uppercase tracking-wide",
                      !zone.push_enabled &&
                        "border-warning/40 text-warning"
                    )}
                  >
                    {zone.push_enabled ? "Live" : "Off"}
                  </Badge>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>{zone.gorgone_client_name}</span>
                  <span className="text-border">·</span>
                  <span>{zone.platforms.join(", ")}</span>
                  {!zone.push_enabled && (
                    <>
                      <span className="text-border">·</span>
                      <span className="text-warning/80">
                        Enable push in admin to receive data
                      </span>
                    </>
                  )}
                </div>
              </div>
              {isSelected && (
                <div className="h-2 w-2 shrink-0 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
