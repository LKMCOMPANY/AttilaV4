"use client";

import { useState, useCallback, useTransition, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowLeft,
  Crosshair,
  Shield,
  Users,
  Loader2,
  Filter,
  Globe,
} from "lucide-react";
import { XIcon, TikTokIcon } from "@/components/icons/social-icons";
import { CampaignFiltersSection } from "@/components/campaigns/campaign-filters";
import { CapacityEstimator } from "@/components/campaigns/capacity-estimator";
import {
  updateCampaign,
  getAccountArmies,
  type UpdateCampaignInput,
} from "@/app/actions/campaigns";
import { CAMPAIGN_STATUS_CONFIG, type ArmyOption } from "@/components/campaigns/types";
import type { Campaign, CampaignPlatform, CampaignStatus } from "@/types";

interface CampaignSettingsPanelProps {
  campaign: Campaign;
  accountId: string;
  onBack: () => void;
  onCampaignUpdated: (updated: Campaign) => void;
}

export function CampaignSettingsPanel({
  campaign,
  accountId,
  onBack,
  onCampaignUpdated,
}: CampaignSettingsPanelProps) {
  const [armies, setArmies] = useState<ArmyOption[]>([]);
  const [armiesLoading, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      try {
        setArmies(await getAccountArmies(accountId));
      } catch { /* empty */ }
    });
  }, [accountId]);

  const save = useCallback(
    async (patch: UpdateCampaignInput) => {
      const optimistic = { ...campaign, ...patch } as Campaign;
      onCampaignUpdated(optimistic);

      const { data, error } = await updateCampaign(campaign.id, patch);
      if (error) {
        toast.error("Update failed", { description: error });
        onCampaignUpdated(campaign);
        return;
      }
      if (data) onCampaignUpdated(data);
    },
    [campaign, onCampaignUpdated]
  );

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="h-7 w-7 p-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold tracking-widest uppercase text-muted-foreground">
          Settings
        </h2>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-3">
          <StatusSection campaign={campaign} onSave={save} />
          <CapacityEstimator
            accountId={accountId}
            zoneId={campaign.gorgone_zone_id}
            platforms={campaign.platforms}
            filters={campaign.filters}
            armyIds={campaign.army_ids}
            capacityParams={campaign.capacity_params}
            onParamsChange={(capacity_params) => save({ capacity_params })}
            compact
          />
          <FiltersSection campaign={campaign} onSave={save} />
          <ArmySection
            campaign={campaign}
            armies={armies}
            loading={armiesLoading}
            onSave={save}
          />
          <NetworksSection campaign={campaign} onSave={save} />
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
        <h3 className="text-[13px] font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Networks
// ---------------------------------------------------------------------------

function NetworksSection({
  campaign,
  onSave,
}: {
  campaign: Campaign;
  onSave: (patch: UpdateCampaignInput) => void;
}) {
  const togglePlatform = (p: CampaignPlatform) => {
    const updated = campaign.platforms.includes(p)
      ? campaign.platforms.filter((x) => x !== p)
      : [...campaign.platforms, p];
    if (updated.length > 0) onSave({ platforms: updated });
  };

  return (
    <Section title="Networks" icon={Globe}>
      <div className="flex gap-2">
        {([
          { value: "twitter" as const, label: "X", Icon: XIcon },
          { value: "tiktok" as const, label: "TikTok", Icon: TikTokIcon },
        ]).map(({ value, label, Icon }) => {
          const active = campaign.platforms.includes(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => togglePlatform(value)}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted"
              )}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function StatusSection({
  campaign,
  onSave,
}: {
  campaign: Campaign;
  onSave: (patch: UpdateCampaignInput) => void;
}) {
  const current = CAMPAIGN_STATUS_CONFIG[campaign.status];
  const entries = Object.entries(CAMPAIGN_STATUS_CONFIG) as [CampaignStatus, typeof current][];

  return (
    <Section title="Status" icon={Crosshair}>
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", current.dot)} />
        <Select
          value={campaign.status}
          onValueChange={(v) => onSave({ status: v as CampaignStatus })}
        >
          <SelectTrigger className="h-7 w-auto gap-1.5 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {entries.map(([value, config]) => (
              <SelectItem key={value} value={value}>
                {config.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Army selection
// ---------------------------------------------------------------------------

function ArmySection({
  campaign,
  armies,
  loading,
  onSave,
}: {
  campaign: Campaign;
  armies: ArmyOption[];
  loading: boolean;
  onSave: (patch: UpdateCampaignInput) => void;
}) {
  const toggle = (armyId: string) => {
    const updated = campaign.army_ids.includes(armyId)
      ? campaign.army_ids.filter((id) => id !== armyId)
      : [...campaign.army_ids, armyId];
    onSave({ army_ids: updated });
  };

  return (
    <Section title="Avatar Army" icon={Shield}>
      {loading ? (
        <div className="flex items-center gap-2 py-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Loading...</span>
        </div>
      ) : armies.length === 0 ? (
        <p className="text-xs text-muted-foreground">No armies available</p>
      ) : (
        <div className="space-y-1">
          {armies.map((army) => {
            const active = campaign.army_ids.includes(army.id);
            return (
              <button
                key={army.id}
                type="button"
                onClick={() => toggle(army.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                )}
              >
                <Users className={cn("h-3 w-3 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{army.name}</span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {army.avatar_count}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function FiltersSection({
  campaign,
  onSave,
}: {
  campaign: Campaign;
  onSave: (patch: UpdateCampaignInput) => void;
}) {
  return (
    <Section title="Filters" icon={Filter}>
      <CampaignFiltersSection
        platforms={campaign.platforms}
        filters={campaign.filters}
        onChange={(filters) => onSave({ filters })}
      />
    </Section>
  );
}
