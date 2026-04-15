"use client";

import { useState, useEffect, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Crosshair, BookOpen, Target, MessageSquare } from "lucide-react";
import { EmptyPanel } from "@/components/ui/empty";
import { toast } from "sonner";
import { updateCampaign } from "@/app/actions/campaigns";
import { CampaignNetworkMap } from "./network";
import type { Campaign } from "@/types";

interface CampaignCenterPanelProps {
  campaign: Campaign | null;
  onCampaignUpdated: (updated: Campaign) => void;
}

export function CampaignCenterPanel({
  campaign,
  onCampaignUpdated,
}: CampaignCenterPanelProps) {
  if (!campaign) {
    return (
      <EmptyPanel
        icon={Crosshair}
        title="No campaign selected"
        description="Select a campaign to view its data"
      />
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Top half — 3D campaign cartography */}
      <div className="flex-1 border-b">
        <CampaignNetworkMap campaignId={campaign.id} />
      </div>

      {/* Bottom half — Guidelines in tabs */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <GuidelineTabs
          campaign={campaign}
          onCampaignUpdated={onCampaignUpdated}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guidelines tabs
// ---------------------------------------------------------------------------

const TABS = [
  {
    value: "context",
    label: "Context",
    icon: BookOpen,
    field: "operational_context" as const,
    placeholder: "Describe the situation, background, and what the AI needs to know...",
  },
  {
    value: "strategy",
    label: "Strategy",
    icon: Target,
    field: "strategy" as const,
    placeholder: "Define the objectives and behavioral rules for avatars...",
  },
  {
    value: "messages",
    label: "Messages",
    icon: MessageSquare,
    field: "key_messages" as const,
    placeholder: "Specific phrases, hashtags, or terminology to use or avoid...",
  },
] as const;

type GuidelineField = (typeof TABS)[number]["field"];

function GuidelineTabs({
  campaign,
  onCampaignUpdated,
}: {
  campaign: Campaign;
  onCampaignUpdated: (updated: Campaign) => void;
}) {
  const save = useCallback(
    async (field: GuidelineField, value: string) => {
      const patch = { [field]: value || null };
      onCampaignUpdated({ ...campaign, ...patch });

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
    <Tabs defaultValue="context" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center overflow-x-auto border-b px-3 scrollbar-hide">
        <TabsList variant="line">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="gap-1.5 text-[11px]"
              >
                <Icon className="h-3 w-3" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>

      <div className="min-h-0 flex-1">
        {TABS.map((tab) => (
          <TabsContent
            key={tab.value}
            value={tab.value}
            className="h-full p-0"
          >
            <GuidelineEditor
              key={`${campaign.id}-${tab.field}`}
              value={campaign[tab.field] ?? ""}
              placeholder={tab.placeholder}
              onCommit={(v) => save(tab.field, v)}
            />
          </TabsContent>
        ))}
      </div>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Full-height textarea editor
// ---------------------------------------------------------------------------

function GuidelineEditor({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  const commit = () => {
    if (local.trim() !== value.trim()) onCommit(local.trim());
  };

  return (
    <Textarea
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      placeholder={placeholder}
      className="h-full min-h-0 resize-none rounded-none border-0 text-xs focus-visible:ring-0 focus-visible:ring-offset-0"
    />
  );
}
