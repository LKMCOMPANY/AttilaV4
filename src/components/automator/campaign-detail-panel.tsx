"use client";

import { Crosshair } from "lucide-react";
import { EmptyPanel } from "@/components/ui/empty";
import { PipelineStats } from "./pipeline-stats";
import { PipelineActivity } from "./pipeline-activity";
import type { Campaign } from "@/types";

interface CampaignDetailPanelProps {
  campaign: Campaign | null;
  pipelineVersion?: number;
}

export function CampaignDetailPanel({
  campaign,
  pipelineVersion,
}: CampaignDetailPanelProps) {
  if (!campaign) {
    return (
      <EmptyPanel
        icon={Crosshair}
        title="Select a campaign"
        description="Choose a campaign from the list to view details"
      />
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <PipelineStats campaign={campaign} />
      <div className="min-h-0 flex-1">
        {/* `key` resets toolbar / pagination / overlay state when the
            campaign in view changes, in lieu of an effect-based reset. */}
        <PipelineActivity
          key={campaign.id}
          campaign={campaign}
          pipelineVersion={pipelineVersion}
        />
      </div>
    </div>
  );
}
