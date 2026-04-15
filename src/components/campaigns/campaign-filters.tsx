"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { XIcon, TikTokIcon } from "@/components/icons/social-icons";
import { Users, Globe } from "lucide-react";
import type { CampaignFilters, CampaignPlatform } from "@/types";

interface CampaignFiltersProps {
  platforms: CampaignPlatform[];
  filters: CampaignFilters;
  onChange: (filters: CampaignFilters) => void;
}

export function CampaignFiltersSection({
  platforms,
  filters,
  onChange,
}: CampaignFiltersProps) {
  const update = (patch: Partial<CampaignFilters>) => {
    onChange({ ...filters, ...patch });
  };

  const hasTwitter = platforms.includes("twitter");
  const hasTiktok = platforms.includes("tiktok");

  const togglePostType = (type: "post" | "reply" | "retweet") => {
    const current = filters.post_types ?? [];
    const updated = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    update({ post_types: updated.length > 0 ? updated : undefined });
  };

  return (
    <div className="space-y-3">
      {/* Common filters */}
      <FilterGroup
        icon={<Users className="h-3 w-3" />}
        label="Common"
      >
        <div className="grid grid-cols-2 gap-1.5">
          <NumericField
            id="min-followers"
            label="Min followers"
            placeholder="e.g. 100"
            value={filters.min_author_followers}
            onChange={(v) => update({ min_author_followers: v })}
          />
          <NumericField
            id="min-engagement"
            label="Min engagement"
            placeholder="e.g. 50"
            value={filters.min_engagement}
            onChange={(v) => update({ min_engagement: v })}
          />
        </div>

        <SwitchRow
          label="Verified only"
          checked={filters.verified_only ?? false}
          onChange={(v) => update({ verified_only: v })}
        />

        <div className="space-y-0.5">
          <Label htmlFor="languages" className="text-[10px] text-muted-foreground">
            <Globe className="mr-1 inline h-2.5 w-2.5" />
            Languages (comma-separated)
          </Label>
          <Input
            id="languages"
            placeholder="e.g. en, fr"
            value={filters.languages?.join(", ") ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              const langs = val
                ? val
                    .split(",")
                    .map((l) => l.trim())
                    .filter(Boolean)
                : undefined;
              update({ languages: langs });
            }}
            className="h-7 text-xs"
          />
        </div>
      </FilterGroup>

      {/* X (Twitter) filters */}
      {hasTwitter && (
        <FilterGroup
          icon={<XIcon className="h-3 w-3" />}
          label="X (Twitter)"
        >
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">
              Post Types
            </Label>
            <div className="flex flex-wrap gap-1">
              {(["post", "reply", "retweet"] as const).map((type) => {
                const isSelected = filters.post_types?.includes(type);
                const labels = {
                  post: "Original",
                  reply: "Reply",
                  retweet: "Retweet",
                };
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => togglePostType(type)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                      isSelected
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {labels[type]}
                  </button>
                );
              })}
            </div>
            <p className="text-[9px] text-muted-foreground/60">
              No selection = all types
            </p>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <NumericField
              id="tw-min-likes"
              label="Min likes"
              value={filters.min_like_count}
              onChange={(v) => update({ min_like_count: v })}
            />
            <NumericField
              id="tw-min-views"
              label="Min views"
              value={filters.min_view_count}
              onChange={(v) => update({ min_view_count: v })}
            />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <NumericField
              id="tw-min-replies"
              label="Min replies"
              value={filters.min_reply_count}
              onChange={(v) => update({ min_reply_count: v })}
            />
            <NumericField
              id="tw-min-quotes"
              label="Min quotes"
              value={filters.min_quote_count}
              onChange={(v) => update({ min_quote_count: v })}
            />
            <NumericField
              id="tw-min-retweets"
              label="Min RTs"
              value={filters.min_retweet_count}
              onChange={(v) => update({ min_retweet_count: v })}
            />
          </div>
        </FilterGroup>
      )}

      {/* TikTok filters */}
      {hasTiktok && (
        <FilterGroup
          icon={<TikTokIcon className="h-3 w-3" />}
          label="TikTok"
        >
          <SwitchRow
            label="Exclude ads"
            checked={filters.exclude_ads ?? false}
            onChange={(v) => update({ exclude_ads: v })}
          />
          <SwitchRow
            label="Exclude private"
            checked={filters.exclude_private ?? false}
            onChange={(v) => update({ exclude_private: v })}
          />

          <div className="grid grid-cols-2 gap-1.5">
            <NumericField
              id="tt-min-plays"
              label="Min plays"
              value={filters.min_play_count}
              onChange={(v) => update({ min_play_count: v })}
            />
            <NumericField
              id="tt-min-comments"
              label="Min comments"
              value={filters.min_comment_count}
              onChange={(v) => update({ min_comment_count: v })}
            />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <NumericField
              id="tt-min-diggs"
              label="Min likes"
              value={filters.min_digg_count}
              onChange={(v) => update({ min_digg_count: v })}
            />
            <NumericField
              id="tt-min-shares"
              label="Min shares"
              value={filters.min_share_count}
              onChange={(v) => update({ min_share_count: v })}
            />
            <NumericField
              id="tt-min-collects"
              label="Min saves"
              value={filters.min_collect_count}
              onChange={(v) => update({ min_collect_count: v })}
            />
          </div>
        </FilterGroup>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FilterGroup({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-md border p-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      {children}
    </div>
  );
}

function NumericField({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder?: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div className="space-y-0.5">
      <Label htmlFor={id} className="text-[10px] text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value ? parseInt(e.target.value) : undefined)
        }
        className="h-7 text-xs"
      />
    </div>
  );
}

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border px-2.5 py-1.5">
      <span className="text-xs">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
