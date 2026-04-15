"use client";

import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { CampaignListItem } from "./campaign-list-item";
import { CreateCampaignDialog } from "@/components/campaigns/create-campaign-dialog";
import type { Campaign } from "@/types";
import type { CampaignSortField } from "./automator-layout";

const SORT_OPTIONS: { value: CampaignSortField; label: string; short: string }[] = [
  { value: "created", label: "Created", short: "New" },
  { value: "alphabetical", label: "A → Z", short: "A-Z" },
  { value: "status", label: "Status", short: "Stat" },
];

interface CampaignListPanelProps {
  campaigns: Campaign[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  sortField: CampaignSortField;
  onSortChange: (field: CampaignSortField) => void;
  accountId: string;
}

export function CampaignListPanel({
  campaigns,
  selectedId,
  onSelect,
  sortField,
  onSortChange,
  accountId,
}: CampaignListPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="@container/list flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground">
          Campaigns
          <span className="ml-1.5 text-foreground/50">{campaigns.length}</span>
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDialogOpen(true)}
          className="h-7 w-7 p-0 @[220px]/list:w-auto @[220px]/list:gap-1.5 @[220px]/list:px-2"
        >
          <Plus className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden @[220px]/list:inline text-xs">New</span>
        </Button>
      </div>

      {/* Sort toolbar */}
      <div
        role="toolbar"
        aria-label="Sort campaigns"
        className="flex shrink-0 gap-0.5 overflow-x-auto border-b px-1.5 py-1.5 scrollbar-hide"
      >
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onSortChange(opt.value)}
            aria-pressed={sortField === opt.value}
            className={cn(
              "shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              sortField === opt.value
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <span className="hidden @[260px]/list:inline">{opt.label}</span>
            <span className="@[260px]/list:hidden">{opt.short}</span>
          </button>
        ))}
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div role="listbox" aria-label="Campaigns" className="p-1.5">
          {campaigns.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <div className="rounded-full bg-muted p-3">
                <Search className="h-5 w-5 text-muted-foreground/50" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  No campaigns yet
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground/60">
                  Create your first campaign to get started
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDialogOpen(true)}
                className="mt-1 gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                Create Campaign
              </Button>
            </div>
          ) : (
            <div className="space-y-px">
              {campaigns.map((campaign) => (
                <CampaignListItem
                  key={campaign.id}
                  campaign={campaign}
                  isSelected={campaign.id === selectedId}
                  onSelect={() => onSelect(campaign.id)}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <CreateCampaignDialog
        accountId={accountId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
