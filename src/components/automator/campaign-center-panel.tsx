"use client";

import { useState, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  BookOpen,
  Crosshair,
  Loader2,
  MessageSquare,
  Sparkles,
  Target,
} from "lucide-react";
import { EmptyPanel } from "@/components/ui/empty";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  setCampaignGuidelinesAutoUpdate,
  updateCampaign,
} from "@/app/actions/campaigns";
import { CampaignNetworkMap } from "./network";
import {
  GuidelinePreviewDialog,
  type GuidelineTriple,
} from "@/components/campaigns/guideline-preview-dialog";
import { useGuidelineGeneration } from "@/components/campaigns/use-guideline-generation";
import type { Campaign } from "@/types";

interface CampaignCenterPanelProps {
  campaign: Campaign | null;
  pipelineVersion?: number;
  onCampaignUpdated: (updated: Campaign) => void;
}

export function CampaignCenterPanel({
  campaign,
  pipelineVersion,
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
      {/* Top half — 3D campaign cartography. `key={campaign.id}` resets
          the map's selected-node + camera state when the operator
          switches between campaigns (React 19 idiomatic — avoids the
          set-state-in-effect anti-pattern). */}
      <div className="flex-1 border-b">
        <CampaignNetworkMap
          key={campaign.id}
          campaignId={campaign.id}
          pipelineVersion={pipelineVersion}
        />
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
  const generation = useGuidelineGeneration();

  const save = useCallback(
    async (patch: Partial<Campaign>) => {
      onCampaignUpdated({ ...campaign, ...patch });
      const { data, error } = await updateCampaign(campaign.id, patch);
      if (error) {
        toast.error("Update failed", { description: error });
        onCampaignUpdated(campaign);
        return;
      }
      if (data) onCampaignUpdated(data);
    },
    [campaign, onCampaignUpdated],
  );

  const saveField = useCallback(
    (field: GuidelineField, value: string) =>
      save({ [field]: value || null } as Partial<Campaign>),
    [save],
  );

  const handleApplyTriple = useCallback(
    (triple: GuidelineTriple) => {
      // Single update — three columns + the generation timestamp in
      // one round-trip so the UI never sees an inconsistent state.
      save({
        operational_context: triple.operational_context,
        strategy: triple.strategy,
        key_messages: triple.key_messages,
        guidelines_generated_at: new Date().toISOString(),
      });
    },
    [save],
  );

  const handleStart = () =>
    generation.start({ mode: "saved", campaignId: campaign.id });

  const handleAutoUpdateChange = useCallback(
    async (enabled: boolean) => {
      // Optimistic — server action does the persistence; on error we
      // surface a toast and revert.
      onCampaignUpdated({ ...campaign, guidelines_auto_update: enabled });
      const { error } = await setCampaignGuidelinesAutoUpdate({
        campaignId: campaign.id,
        enabled,
      });
      if (error) {
        toast.error("Could not update auto-refresh", { description: error });
        onCampaignUpdated(campaign);
      }
    },
    [campaign, onCampaignUpdated],
  );

  const lastGenerated = campaign.guidelines_generated_at
    ? formatDistanceToNow(new Date(campaign.guidelines_generated_at), {
        addSuffix: true,
      })
    : null;

  return (
    <Tabs defaultValue="context" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 scrollbar-hide">
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

        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Label
              htmlFor={`auto-update-${campaign.id}`}
              className="cursor-pointer text-[10px] text-muted-foreground"
              title="When on, the daily cron regenerates these guidelines from the zone’s recent activity"
            >
              Auto-update
            </Label>
            <Switch
              id={`auto-update-${campaign.id}`}
              size="sm"
              checked={campaign.guidelines_auto_update}
              onCheckedChange={handleAutoUpdateChange}
            />
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleStart}
            disabled={generation.isGenerating}
            className="h-7 gap-1 text-[11px]"
          >
            {generation.isGenerating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {generation.isGenerating ? "Generating…" : "Generate with AI"}
          </Button>
        </div>
      </div>

      {lastGenerated && (
        <p className="shrink-0 px-3 pt-1 text-[10px] text-muted-foreground/60">
          Last AI generation {lastGenerated}
        </p>
      )}

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
              onCommit={(v) => saveField(tab.field, v)}
            />
          </TabsContent>
        ))}
      </div>

      <GuidelinePreviewDialog
        open={generation.isDialogOpen}
        onOpenChange={generation.setDialogOpen}
        loading={generation.isGenerating}
        result={generation.result}
        error={generation.error}
        onApply={handleApplyTriple}
      />
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
  // React 19 idiom for syncing a local edit buffer with an upstream prop:
  // compare in render against a `prevValue` shadow and reset together.
  // Avoids the `set-state-in-effect` cascade flagged by the lint.
  const [local, setLocal] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setLocal(value);
  }

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
