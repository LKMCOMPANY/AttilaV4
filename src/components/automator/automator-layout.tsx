"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Group, Panel } from "react-resizable-panels";
import { ResizableHandle } from "@/components/ui/resizable";
import { useRealtimeCampaign } from "@/hooks/use-realtime-campaign";
import { getCampaign } from "@/app/actions/campaigns";
import { CampaignListPanel } from "./campaign-list-panel";
import { CampaignSettingsPanel } from "./campaign-settings-panel";
import { CampaignCenterPanel } from "./campaign-center-panel";
import { CampaignDetailPanel } from "./campaign-detail-panel";
import { RealtimeIndicator } from "./realtime-indicator";
import type { Campaign } from "@/types";

export type CampaignSortField = "created" | "alphabetical" | "status";

interface AutomatorLayoutProps {
  accountId: string;
  campaigns: Campaign[];
}

const panelStyle = { overflow: "hidden" as const, height: "100%" as const };
const defaultLayout = { list: 33, center: 34, details: 33 };

export function AutomatorLayout({
  accountId,
  campaigns,
}: AutomatorLayoutProps) {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<CampaignSortField>("created");
  const [localCampaigns, setLocalCampaigns] = useState(campaigns);

  const { pipelineVersion, countersVersion, status: realtimeStatus } =
    useRealtimeCampaign(selectedCampaignId);

  useEffect(() => {
    setLocalCampaigns(campaigns);
  }, [campaigns]);

  useEffect(() => {
    if (localCampaigns.length === 0) {
      setSelectedCampaignId(null);
      return;
    }
    if (selectedCampaignId && !localCampaigns.some((c) => c.id === selectedCampaignId)) {
      setSelectedCampaignId(null);
    }
  }, [localCampaigns, selectedCampaignId]);

  // Refetch campaign counters when realtime signals a change
  useEffect(() => {
    if (!selectedCampaignId || countersVersion === 0) return;
    getCampaign(selectedCampaignId).then((fresh) => {
      if (fresh) {
        setLocalCampaigns((prev) =>
          prev.map((c) => (c.id === fresh.id ? fresh : c)),
        );
      }
    });
  }, [countersVersion, selectedCampaignId]);

  const sortedCampaigns = useMemo(() => {
    const list = [...localCampaigns];
    switch (sortField) {
      case "alphabetical":
        return list.sort((a, b) => a.name.localeCompare(b.name));
      case "status":
        return list.sort((a, b) => a.status.localeCompare(b.status));
      case "created":
      default:
        return list.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
    }
  }, [localCampaigns, sortField]);

  const selectedCampaign = useMemo(
    () => localCampaigns.find((c) => c.id === selectedCampaignId) ?? null,
    [localCampaigns, selectedCampaignId]
  );

  const handleSelectCampaign = useCallback((id: string) => {
    setSelectedCampaignId(id);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedCampaignId(null);
  }, []);

  const handleCampaignUpdated = useCallback((updated: Campaign) => {
    setLocalCampaigns((prev) =>
      prev.map((c) => (c.id === updated.id ? updated : c))
    );
  }, []);

  return (
    <Group orientation="horizontal" defaultLayout={defaultLayout}>
      <Panel id="list" minSize="15%" maxSize="50%" style={panelStyle}>
        {selectedCampaign ? (
          <CampaignSettingsPanel
            key={selectedCampaign.id}
            campaign={selectedCampaign}
            accountId={accountId}
            onBack={handleBack}
            onCampaignUpdated={handleCampaignUpdated}
          />
        ) : (
          <CampaignListPanel
            campaigns={sortedCampaigns}
            selectedId={selectedCampaignId}
            onSelect={handleSelectCampaign}
            sortField={sortField}
            onSortChange={setSortField}
            accountId={accountId}
          />
        )}
      </Panel>

      <ResizableHandle withHandle />

      <Panel id="center" minSize="15%" maxSize="50%" style={panelStyle}>
        <CampaignCenterPanel
          campaign={selectedCampaign}
          pipelineVersion={pipelineVersion}
          onCampaignUpdated={handleCampaignUpdated}
        />
      </Panel>

      <ResizableHandle withHandle />

      <Panel id="details" minSize="20%" style={panelStyle}>
        <div className="relative h-full">
          <CampaignDetailPanel
            campaign={selectedCampaign}
            pipelineVersion={pipelineVersion}
          />
          {selectedCampaign && (
            <RealtimeIndicator status={realtimeStatus} />
          )}
        </div>
      </Panel>
    </Group>
  );
}
