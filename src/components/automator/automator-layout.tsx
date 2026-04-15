"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Group, Panel } from "react-resizable-panels";
import { ResizableHandle } from "@/components/ui/resizable";
import { CampaignListPanel } from "./campaign-list-panel";
import { CampaignSettingsPanel } from "./campaign-settings-panel";
import { CampaignCenterPanel } from "./campaign-center-panel";
import { CampaignDetailPanel } from "./campaign-detail-panel";
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
          onCampaignUpdated={handleCampaignUpdated}
        />
      </Panel>

      <ResizableHandle withHandle />

      <Panel id="details" minSize="20%" style={panelStyle}>
        <CampaignDetailPanel campaign={selectedCampaign} />
      </Panel>
    </Group>
  );
}
