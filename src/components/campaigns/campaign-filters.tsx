"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";
import { XIcon, TikTokIcon } from "@/components/icons/social-icons";
import { Users, Globe } from "lucide-react";
import type { CampaignFilters, CampaignPlatform } from "@/types";

/**
 * Campaign filter controls. Every filter here is enforced 1:1 by the
 * runtime pipeline (`lib/pipeline/filter.ts`) and simulated by the
 * capacity estimator — keep the three in sync when adding a filter.
 */

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

  return (
    <div className="space-y-3">
      {/* Common filters */}
      <FilterGroup
        icon={<Users className="h-3 w-3" />}
        label="Common"
        tip="Applied on every platform. Leave a field empty to disable it — a post must satisfy ALL configured filters to receive a response."
      >
        <div className="grid grid-cols-2 gap-1.5">
          <NumericField
            id="min-followers"
            label="Min followers"
            tip="The post's author must have at least this many followers."
            placeholder="e.g. 100"
            value={filters.min_author_followers}
            onChange={(v) => update({ min_author_followers: v })}
          />
          <NumericField
            id="min-engagement"
            label="Min engagement"
            tip="Total engagement of the post: likes + reposts + replies + quotes on X; likes + comments + shares on TikTok."
            placeholder="e.g. 50"
            value={filters.min_engagement}
            onChange={(v) => update({ min_engagement: v })}
          />
        </div>

        <SwitchRow
          label="Verified only"
          tip="Only respond to verified authors (blue or legacy checkmark on X, verified badge on TikTok)."
          checked={filters.verified_only ?? false}
          onChange={(v) => update({ verified_only: v })}
        />

        <div className="space-y-0.5">
          <Label htmlFor="languages" className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Globe className="h-2.5 w-2.5" />
            Languages (comma-separated)
            <InfoTip>
              ISO codes of the post language as detected upstream — e.g.
              &quot;en, fr, ar&quot;. The Zone snapshot in the Capacity panel
              lists the codes actually present in this zone. Empty = all
              languages.
            </InfoTip>
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
                    .map((l) => l.trim().toLowerCase())
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
          tip="Only applied to posts coming from X. Thresholds compare the post's metrics at collection time."
        >
          <ChipSelector
            label="Post types"
            tip="Which kinds of X posts the campaign responds to."
            options={[
              { value: "post", label: "Original" },
              { value: "reply", label: "Reply" },
              { value: "retweet", label: "Retweet" },
            ]}
            selected={filters.post_types ?? []}
            emptyHint="No selection = all types"
            onChange={(values) =>
              update({
                post_types: values.length > 0 ? (values as ("post" | "reply" | "retweet")[]) : undefined,
              })
            }
          />

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
          tip="Only applied to posts coming from TikTok. Thresholds compare the post's metrics at collection time."
        >
          <ChipSelector
            label="Content types"
            tip="TikTok zones collect videos AND the comments under them — comments often dominate the volume. Choose what the campaign responds to."
            options={[
              { value: "video", label: "Videos" },
              { value: "comment", label: "Comments" },
            ]}
            selected={filters.tiktok_content_kinds ?? []}
            emptyHint="No selection = videos + comments"
            onChange={(values) =>
              update({
                tiktok_content_kinds:
                  values.length > 0 ? (values as ("video" | "comment")[]) : undefined,
              })
            }
          />

          <SwitchRow
            label="Exclude ads"
            tip="Skip sponsored / promoted videos."
            checked={filters.exclude_ads ?? false}
            onChange={(v) => update({ exclude_ads: v })}
          />
          <SwitchRow
            label="Exclude private"
            tip="Skip posts from private accounts — avatars can't interact with them."
            checked={filters.exclude_private ?? false}
            onChange={(v) => update({ exclude_private: v })}
          />

          <div className="grid grid-cols-2 gap-1.5">
            <NumericField
              id="tt-min-plays"
              label="Min plays"
              tip="Video view count. Comments have 0 plays — set a Min plays only if you target videos."
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
  tip,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  tip: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-md border p-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-[11px] font-medium">{label}</span>
        <InfoTip>{tip}</InfoTip>
      </div>
      {children}
    </div>
  );
}

function ChipSelector({
  label,
  tip,
  options,
  selected,
  emptyHint,
  onChange,
}: {
  label: string;
  tip: string;
  options: { value: string; label: string }[];
  selected: string[];
  emptyHint: string;
  onChange: (values: string[]) => void;
}) {
  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  return (
    <div className="space-y-1">
      <Label className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {label}
        <InfoTip>{tip}</InfoTip>
      </Label>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => {
          const isSelected = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggle(option.value)}
              aria-pressed={isSelected}
              className={cn(
                "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                isSelected
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="text-[9px] text-muted-foreground/60">{emptyHint}</p>
    </div>
  );
}

function NumericField({
  id,
  label,
  tip,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  tip?: string;
  placeholder?: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div className="space-y-0.5">
      <Label
        htmlFor={id}
        className="flex items-center gap-1 text-[10px] text-muted-foreground"
      >
        {label}
        {tip && <InfoTip>{tip}</InfoTip>}
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
  tip,
  checked,
  onChange,
}: {
  label: string;
  tip: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border px-2.5 py-1.5">
      <span className="flex items-center gap-1 text-xs">
        {label}
        <InfoTip>{tip}</InfoTip>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
