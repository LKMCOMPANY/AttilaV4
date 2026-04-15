"use client";

import { Crosshair } from "lucide-react";
import { EmptyPanel } from "@/components/ui/empty";
import { PipelineActivity } from "./pipeline-activity";
import type { Campaign } from "@/types";

interface CampaignDetailPanelProps {
  campaign: Campaign | null;
}

export function CampaignDetailPanel({ campaign }: CampaignDetailPanelProps) {
  if (!campaign) {
    return (
      <EmptyPanel
        icon={Crosshair}
        title="Select a campaign"
        description="Choose a campaign from the list to view details"
      />
    );
  }

  return <PipelineActivity campaign={campaign} />;
}
