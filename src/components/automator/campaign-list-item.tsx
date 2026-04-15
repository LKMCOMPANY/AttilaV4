"use client";

import { cn } from "@/lib/utils";
import { Crosshair } from "lucide-react";
import { XIcon, TikTokIcon } from "@/components/icons/social-icons";
import { CAMPAIGN_STATUS_CONFIG } from "@/components/campaigns/types";
import type { Campaign } from "@/types";

interface CampaignListItemProps {
  campaign: Campaign;
  isSelected: boolean;
  onSelect: () => void;
}

export function CampaignListItem({
  campaign,
  isSelected,
  onSelect,
}: CampaignListItemProps) {
  const platformIcons = campaign.platforms.map((p) => {
    if (p === "twitter") return <XIcon key={p} className="h-3 w-3" />;
    return <TikTokIcon key={p} className="h-3 w-3" />;
  });

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <Crosshair className="h-4 w-4 text-primary" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">
            {campaign.name}
          </p>
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              CAMPAIGN_STATUS_CONFIG[campaign.status].dot
            )}
          />
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="capitalize">{campaign.mode}</span>
          <span className="text-border">·</span>
          <span className="flex items-center gap-0.5">{platformIcons}</span>
        </div>
      </div>
    </button>
  );
}
