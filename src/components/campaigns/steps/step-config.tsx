"use client";

import { useEffect, useState, useTransition } from "react";
import { Label } from "@/components/ui/label";
import { Loader2, Shield, Users, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAccountArmies } from "@/app/actions/campaigns";
import { CampaignFiltersSection } from "../campaign-filters";
import { CapacityPreview } from "../capacity-preview";
import type { StepProps, ArmyOption } from "../types";

export function StepConfig({ data, onChange, accountId }: StepProps) {
  const [armies, setArmies] = useState<ArmyOption[]>([]);
  const [loading, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      try {
        const result = await getAccountArmies(accountId);
        setArmies(result);
      } catch {
        // Empty list shown on failure
      }
    });
  }, [accountId]);

  const toggleArmy = (armyId: string) => {
    const current = data.army_ids;
    const updated = current.includes(armyId)
      ? current.filter((id) => id !== armyId)
      : [...current, armyId];
    onChange({ army_ids: updated });
  };

  const totalAvatars = armies
    .filter((a) => data.army_ids.includes(a.id))
    .reduce((sum, a) => sum + a.avatar_count, 0);

  return (
    <div className="space-y-6 px-1">
      {/* A — Army selection */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <Label>Avatar Army</Label>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading armies...</span>
          </div>
        ) : armies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No armies available. Create armies in the Operator section first.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {armies.map((army) => {
              const isSelected = data.army_ids.includes(army.id);
              return (
                <button
                  key={army.id}
                  type="button"
                  onClick={() => toggleArmy(army.id)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30 hover:bg-muted/50"
                  )}
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                      isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                    )}
                  >
                    <Users className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{army.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {army.avatar_count} avatar{army.avatar_count !== 1 ? "s" : ""}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* B — Filters by platform */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Label>Post & Author Filters</Label>
        </div>
        <CampaignFiltersSection
          platforms={data.platforms}
          filters={data.filters}
          onChange={(filters) => onChange({ filters })}
        />
      </div>

      {/* C — Capacity estimator preview */}
      <CapacityPreview totalAvatars={totalAvatars} armyCount={data.army_ids.length} />
    </div>
  );
}
