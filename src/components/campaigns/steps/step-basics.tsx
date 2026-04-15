"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Crosshair } from "lucide-react";
import { XIcon, TikTokIcon } from "@/components/icons/social-icons";
import type { StepProps } from "../types";
import type { CampaignPlatform } from "@/types";

const MODES = [
  {
    value: "sniper" as const,
    label: "Sniper",
    description: "Real-time response to matching posts from Gorgone zones",
    icon: Crosshair,
  },
];

const PLATFORMS: {
  value: CampaignPlatform;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "twitter",
    label: "X (Twitter)",
    icon: <XIcon className="h-4 w-4" />,
  },
  {
    value: "tiktok",
    label: "TikTok",
    icon: <TikTokIcon className="h-4 w-4" />,
  },
];

export function StepBasics({ data, onChange }: StepProps) {
  const togglePlatform = (platform: CampaignPlatform) => {
    const current = data.platforms;
    const updated = current.includes(platform)
      ? current.filter((p) => p !== platform)
      : [...current, platform];
    onChange({ platforms: updated });
  };

  return (
    <div className="space-y-6 px-1">
      {/* Campaign name */}
      <div className="space-y-2">
        <Label htmlFor="campaign-name">Campaign Name</Label>
        <Input
          id="campaign-name"
          placeholder="e.g. UK Elections Q2"
          value={data.name}
          onChange={(e) => onChange({ name: e.target.value })}
          maxLength={120}
          autoFocus
        />
      </div>

      {/* Mode selection */}
      <div className="space-y-2">
        <Label>Campaign Mode</Label>
        <div className="grid gap-2">
          {MODES.map((mode) => {
            const Icon = mode.icon;
            const isSelected = data.mode === mode.value;
            return (
              <button
                key={mode.value}
                type="button"
                onClick={() => onChange({ mode: mode.value })}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/30 hover:bg-muted/50"
                )}
              >
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                    isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{mode.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {mode.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Platform selection */}
      <div className="space-y-2">
        <Label>Target Networks</Label>
        <div className="grid grid-cols-2 gap-2">
          {PLATFORMS.map((platform) => {
            const isSelected = data.platforms.includes(platform.value);
            return (
              <button
                key={platform.value}
                type="button"
                onClick={() => togglePlatform(platform.value)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border p-3 transition-colors",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/30 hover:bg-muted/50"
                )}
              >
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-md",
                    isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                  )}
                >
                  {platform.icon}
                </div>
                <span className="text-sm font-medium">{platform.label}</span>
              </button>
            );
          })}
        </div>
        {data.platforms.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Select at least one network
          </p>
        )}
      </div>
    </div>
  );
}
